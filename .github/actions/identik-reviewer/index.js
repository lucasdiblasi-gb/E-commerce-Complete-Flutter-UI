const core = require('@actions/core');
const github = require('@actions/github');
const { OpenAI } = require('openai');

async function run() {
  try {
    const apiKey = core.getInput('openai-api-key');
    const token = core.getInput('github-token');
    
    if (!github.context.payload.pull_request) {
      core.info('⚠️ Esta Action só funciona em Pull Requests.');
      return;
    }

    const octokit = github.getOctokit(token);
    const openai = new OpenAI({
       apiKey: apiKey,
       baseURL: "https://models.inference.ai.azure.com"
    });

    const { owner, repo } = github.context.repo;
    const pull_number = github.context.payload.pull_request.number;
    const head_sha = github.context.payload.pull_request.head.sha;

    core.info(`📦 Analisando PR #${pull_number} no commit ${head_sha.substring(0, 7)}`);

    // 1. Lista os arquivos do PR
    const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number });

    for (const file of files) {
      // Ignora arquivos removidos ou fora da lib (e arquivos de configuração)
      if (!file.filename.endsWith('.dart') || file.status === 'removed' || file.filename.startsWith('.github/')) continue;

      core.info(`🔍 ANALISANDO: ${file.filename}`);

      try {
        // 2. USANDO A API DE BLOB (mais estável que getContent para PRs)
        const { data: blob } = await octokit.rest.git.getBlob({
          owner,
          repo,
          file_sha: file.sha, // O SHA do arquivo já vem na listagem do PR
        });

        if (!blob.content) {
          core.warning(`⚠️ O conteúdo de ${file.filename} não foi recuperado. Pulando...`);
          continue;
        }

        const content = Buffer.from(blob.content, 'base64').toString('utf8');

        if (!content.trim()) {
          core.info(`📄 O arquivo ${file.filename} está vazio.`);
          continue;
        }

        // 3. Prompt para Identik
        const prompt = `Analise o código Flutter abaixo. Identifique widgets interativos (Buttons, TextFields, InkWell, GestureDetector) que não usam 'Identik'.
Sugira envolver o widget com: Identik(id: 'prefixo_nome', label: 'Descrição', child: widget).
Prefixos: btn_, input_, ic_, txt_.
Responda APENAS com um JSON puro: {"suggestions": [{"line": 10, "newCode": "Identik(...)"}]}`;

        core.info(`🤖 Chamando IA para ${file.filename}...`);
        
        const response = await openai.chat.completions.create({
          model: "gpt-4o", 
          messages: [{ role: "system", content: prompt }, { role: "user", content: content }],
          response_format: { type: "json_object" },
          temperature: 0.1
        });

        const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');
        
        if (result.suggestions && result.suggestions.length > 0) {
          core.info(`✅ IA sugeriu ${result.suggestions.length} melhorias.`);
          for (const s of result.suggestions) {
            await octokit.rest.pulls.createReviewComment({
              owner, repo, pull_number,
              body: `🤖 **Identik AI Review**\n\n\`\`\`suggestion\n${s.newCode}\n\`\`\``,
              commit_id: head_sha,
              path: file.filename,
              line: parseInt(s.line),
              side: "RIGHT"
            });
          }
        } else {
          core.info(`✅ Nenhuma melhoria sugerida para ${file.filename}.`);
        }

      } catch (fileErr) {
        core.error(`❌ Erro no arquivo ${file.filename}: ${fileErr.message}`);
      }
    }
    core.info("🚀 Processo concluído!");
  } catch (error) {
    core.setFailed(`❌ Erro Fatal: ${error.message}`);
  }
}

run();