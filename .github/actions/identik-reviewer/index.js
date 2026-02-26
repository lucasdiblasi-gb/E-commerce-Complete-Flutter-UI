const core = require('@actions/core');
const github = require('@actions/github');
const { OpenAI } = require('openai');

async function run() {
  try {
    const apiKey = core.getInput('openai-api-key');
    const token = core.getInput('github-token');
    
    if (!github.context.payload.pull_request) {
      core.info('Fora de um Pull Request. Nada para revisar.');
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

    const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number });

    for (const file of files) {
      if (!file.filename.endsWith('.dart') || file.status === 'removed') continue;

      core.info(`🔍 Analisando: ${file.filename}`);

      const { data: responseData } = await octokit.rest.repos.getContent({
        owner, repo, path: file.path, ref: head_sha
      });

      const content = Buffer.from(responseData.content, 'base64').toString('utf8');

      // PROMPT MAIS AGRESSIVO E DETALHADO
      const prompt = `Você é um revisor de código sênior em Flutter.
Analise o código abaixo e identifique TODOS os widgets interativos (ElevatedButton, TextButton, IconButton, GestureDetector, InkWell, TextField, Switch) que NÃO estão dentro de um widget 'Identik'.

Para cada um, sugira envolver o widget com: Identik(id: 'prefixo_nome', label: 'Descrição', child: widget).
Prefixos obrigatórios: btn_, input_, ic_, txt_.

IMPORTANTE: 
1. Responda APENAS com um JSON.
2. Identifique o número correto da linha onde o widget começa.
3. O 'newCode' deve ser o widget original refatorado com Identik.

Formato: {"suggestions": [{"line": 15, "newCode": "Identik(...)"}]}`;

      core.info(`🤖 Enviando para IA...`);
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Arquivo: ${file.filename}\n\nCódigo:\n${content}` }
        ],
        temperature: 0.2, // Mais determinístico
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');
      
      // LOG DOS RESULTADOS (Para você ver o que a IA pensou no console da Action)
      core.info(`✅ IA retornou ${result.suggestions?.length || 0} sugestões.`);

      if (result.suggestions && result.suggestions.length > 0) {
        for (const s of result.suggestions) {
          core.info(`📌 Aplicando sugestão na linha ${s.line}`);
          
          await octokit.rest.pulls.createReviewComment({
            owner, repo, pull_number,
            body: `🤖 **Identik AI Review**\nDetectei um componente interativo sem identificação. Recomendo envolver com o Identik para facilitar a automação com Maestro.\n\n\`\`\`suggestion\n${s.newCode}\n\`\`\``,
            commit_id: head_sha,
            path: file.filename,
            line: parseInt(s.line),
            side: "RIGHT"
          });
        }
      }
    }
    core.info("🚀 Revisão finalizada com sucesso!");
  } catch (error) {
    core.setFailed(`❌ Erro na Action: ${error.message}`);
  }
}

run();