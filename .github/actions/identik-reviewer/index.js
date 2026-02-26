const core = require('@actions/core');
const github = require('@actions/github');
const { OpenAI } = require('openai');

async function run() {
  try {
    const apiKey = core.getInput('openai-api-key');
    const token = core.getInput('github-token');
    if (!github.context.payload.pull_request) return;

    const octokit = github.getOctokit(token);
    const openai = new OpenAI({ apiKey, baseURL: "https://models.inference.ai.azure.com" });

    const { owner, repo } = github.context.repo;
    const pull_number = github.context.payload.pull_request.number;
    const head_sha = github.context.payload.pull_request.head.sha;

    const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number });

    for (const file of files) {
      if (!file.filename.endsWith('.dart') || file.status === 'removed' || file.filename.startsWith('.github/')) continue;

      const { data: blob } = await octokit.rest.git.getBlob({ owner, repo, file_sha: file.sha });
      const rawContent = Buffer.from(blob.content, 'base64').toString('utf8');

      const contentWithLines = rawContent.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');

      const prompt = `Você é um especialista em Flutter e Clean Code. Analise o código fornecido (que possui números de linha).
Identifique widgets interativos (Buttons, TextFields, InkWell, GestureDetector) que NÃO estão envolvidos por 'Identik'.

REGRAS RÍGIDAS DE CONTEÚDO:
1. NÃO mude a lógica interna. Mantenha os parâmetros do widget original intactos.
2. O campo 'label' deve ser obrigatoriamente em PORTUGUÊS BRASILEIRO (ex: 'Log in' vira 'Entrar', 'Sign up' vira 'Cadastrar-se').
3. Use prefixos: btn_, input_, ic_, txt_ para os IDs.

REGRAS RÍGIDAS DE FORMATAÇÃO (ANTI-LINTER):
1. O 'newCode' deve ser formatado em MÚLTIPLAS LINHAS com a indentação correta do Flutter.
2. NÃO gere o código em uma única linha.
3. Certifique-se de que o widget Identik envolva o widget original de forma limpa.

Retorne APENAS JSON:
{"suggestions": [{"startLine": 45, "endLine": 52, "newCode": "Identik(\\n  id: '...',\\n  label: '...',\\n  child: ...,\\n)"}]}`;

      core.info(`🆔 Analisando com precisão e tradução: ${file.filename}`);
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: prompt }, { role: "user", content: contentWithLines }],
        response_format: { type: "json_object" },
        temperature: 0
      });

      const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');

      for (const s of result.suggestions) {
        try {
          await octokit.rest.pulls.createReviewComment({
            owner, repo, pull_number,
            body: `🆔 **Identik AI Review**\nEncapsulando widget para automação (PT-BR).\n\n\`\`\`suggestion\n${s.newCode}\n\`\`\``,
            commit_id: head_sha,
            path: file.filename,
            line: parseInt(s.endLine), 
            start_line: parseInt(s.startLine),
            side: "RIGHT"
          });
        } catch (e) {
          core.warning(`Falha na sugestão das linhas ${s.startLine}-${s.endLine}: ${e.message}`);
        }
      }
    }
  } catch (error) {
    core.setFailed(`Erro: ${error.message}`);
  }
}
run();