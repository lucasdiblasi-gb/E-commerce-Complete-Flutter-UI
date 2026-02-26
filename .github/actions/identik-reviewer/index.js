const core = require('@actions/core');
const github = require('@actions/github');
const { OpenAI } = require('openai');

async function run() {
  try {
    const apiKey = core.getInput('openai-api-key');
    const token = core.getInput('github-token');
    
    if (!github.context.payload.pull_request) {
      core.info('⚠️ Fora de um Pull Request. Esta Action precisa de um PR para listar arquivos.');
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

    core.info(`📦 Verificando arquivos no PR #${pull_number}...`);

    // Busca os arquivos
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner, repo, pull_number
    });

    core.info(`📂 Total de arquivos modificados detectados: ${files.length}`);

    for (const file of files) {
      core.info(`📄 Checando arquivo: ${file.filename} (Status: ${file.status})`);
      
      if (!file.filename.endsWith('.dart') || file.status === 'removed') {
        core.info(`⏭️ Pulando ${file.filename} (Não é Dart ou foi removido)`);
        continue;
      }

      core.info(`🔍 ANALISANDO: ${file.filename}`);

      const { data: responseData } = await octokit.rest.repos.getContent({
        owner, repo, path: file.path, ref: head_sha
      });

      const content = Buffer.from(responseData.content, 'base64').toString('utf8');

      const prompt = `Você é um especialista em Flutter. Analise o código e sugira o wrapper Identik para widgets interativos sem ID.
      Prefixos: btn_, input_, ic_, txt_.
      Retorne APENAS um JSON: {"suggestions": [{"line": 10, "newCode": "Identik(...)"}]}`;

      core.info(`🤖 Chamando IA para ${file.filename}...`);
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: [{ role: "system", content: prompt }, { role: "user", content: content }],
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');
      core.info(`✅ IA retornou ${result.suggestions?.length || 0} sugestões.`);

      if (result.suggestions && result.suggestions.length > 0) {
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
      }
    }
    core.info("🚀 Processo concluído!");
  } catch (error) {
    core.setFailed(`❌ Erro: ${error.message}`);
  }
}

run();