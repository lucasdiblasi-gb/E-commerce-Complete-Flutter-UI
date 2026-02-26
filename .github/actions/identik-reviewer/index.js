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

    const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number });

    for (const file of files) {
      if (!file.filename.endsWith('.dart') || file.status === 'removed') continue;

      core.info(`🔍 ANALISANDO: ${file.filename}`);

      try {
        const { data: responseData } = await octokit.rest.repos.getContent({
          owner, repo, path: file.path, ref: head_sha
        });

        // PROTEÇÃO: Verifica se o conteúdo realmente veio na resposta
        if (!responseData || typeof responseData.content !== 'string') {
          core.warning(`⚠️ O arquivo ${file.filename} retornou conteúdo vazio ou inválido. Pulando...`);
          continue;
        }

        const content = Buffer.from(responseData.content, 'base64').toString('utf8');

        if (!content.trim()) {
          core.info(`📄 O arquivo ${file.filename} está vazio. Pulando...`);
          continue;
        }

        const prompt = `Analise o código Flutter e sugere o wrapper Identik para widgets interativos sem ID.
        Prefixos: btn_, input_, ic_, txt_.
        Retorne APENAS um JSON: {"suggestions": [{"line": 10, "newCode": "Identik(...)"}]}`;

        core.info(`🤖 Chamando IA para ${file.filename}...`);
        
        const response = await openai.chat.completions.create({
          model: "gpt-4o", 
          messages: [{ role: "system", content: prompt }, { role: "user", content: content }],
          response_format: { type: "json_object" },
        });

        const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');
        
        if (result.suggestions && result.suggestions.length > 0) {
          core.info(`✅ IA sugeriu ${result.suggestions.length} melhorias.`);
          for (const s of result.suggestions) {
            await octokit.rest.pulls.createReviewComment({
              owner, repo, pull_number,
              body: `💡 **Identik AI Suggestion**\n\n\`\`\`suggestion\n${s.newCode}\n\`\`\``,
              commit_id: head_sha,
              path: file.filename,
              line: parseInt(s.line),
              side: "RIGHT"
            });
          }
        } else {
          core.info(`✅ Nenhuma melhoria necessária para ${file.filename}.`);
        }

      } catch (fileErr) {
        core.error(`❌ Erro ao ler conteúdo de ${file.filename}: ${fileErr.message}`);
      }
    }
    core.info("🚀 Processo concluído!");
  } catch (error) {
    core.setFailed(`❌ Erro Fatal: ${error.message}`);
  }
}

run();