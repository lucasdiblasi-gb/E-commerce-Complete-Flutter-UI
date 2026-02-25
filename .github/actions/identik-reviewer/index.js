const core = require('@actions/core');
const github = require('@actions/github');
const { OpenAI } = require('openai');

async function run() {
  try {
    // 1. Pegamos os valores dos INPUTS definidos no action.yml
    const apiKey = core.getInput('openai-api-key');
    const token = core.getInput('github-token');
    
    const octokit = github.getOctokit(token);
    
    // 2. Usamos a variável 'apiKey' que pegamos acima
    const openai = new OpenAI({
       apiKey: apiKey, // Alterado aqui para usar a variável correta
       baseURL: "https://models.inference.ai.azure.com"
    });

    const { owner, repo } = github.context.repo;
    const pull_number = github.context.payload.pull_request.number;

    // 1. Lista arquivos alterados no PR
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner, repo, pull_number
    });

    for (const file of files) {
      if (!file.filename.endsWith('.dart') || file.status === 'removed') continue;

      // 2. Pega o conteúdo do arquivo na branch do PR
      const { data: contentData } = await octokit.rest.repos.getContent({
        owner, repo, path: file.path, ref: github.context.payload.pull_request.head.sha
      });
      const content = Buffer.from(contentData.content, 'base64').toString();

      // 3. Prompt da IA (Estratégia Identik)
      const prompt = `Analise este código Flutter e sugere o wrapper Identik para widgets interativos sem ID.
      Regras: IDs em snake_case com prefixos (btn_, input_, ic_, txt_).
      Retorne APENAS um JSON: {"suggestions": [{"line": 10, "newCode": "Identik(...)"}]}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{ role: "system", content: prompt }, { role: "user", content }],
        response_format: { type: "json_object" },
      });

      const { suggestions } = JSON.parse(response.choices[0].message.content);

      if (suggestions && suggestions.length > 0) {
        for (const s of suggestions) {
          await octokit.rest.pulls.createReviewComment({
            owner, repo, pull_number,
            body: `💡 **Identik AI:** Sugestão de acessibilidade e automação.\n\n\`\`\`suggestion\n${s.newCode}\n\`\`\``,
            commit_id: github.context.payload.pull_request.head.sha,
            path: file.filename,
            line: s.line,
          });
        }
      }
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
