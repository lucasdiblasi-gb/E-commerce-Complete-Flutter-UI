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
      const content = Buffer.from(blob.content, 'base64').toString('utf8');

      const prompt = `Você é um especialista em Flutter. Analise o código fornecido e identifique widgets interativos (Buttons, TextFields, InkWell) que NÃO possuem o wrapper 'Identik'.

REGRAS RÍGIDAS:
1. Mantenha TODO o código original e lógica interna (onPressed, etc) EXATAMENTE como estão. NÃO invente funções.
2. Identifique a linha EXATA onde o widget começa (ex: onde começa 'TextButton(' ou 'ElevatedButton(').
3. O 'newCode' deve ser o widget completo envolvido por: Identik(id: 'prefixo_nome', label: 'Rótulo', child: ...).
4. Substitua o widget INTEIRO na sugestão, não apenas uma linha.

Retorne APENAS JSON:
{"suggestions": [{"line": 45, "newCode": "Identik(...)"}]}`;

      core.info(`🤖 Analisando ${file.filename}...`);
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: prompt }, { role: "user", content }],
        response_format: { type: "json_object" },
        temperature: 0
      });

      const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');

      for (const s of result.suggestions) {
        try {
          // O GitHub exige que o comentário seja feito em uma linha que faça parte do DIFF
          await octokit.rest.pulls.createReviewComment({
            owner, repo, pull_number,
            body: `🤖 **Identik AI Review**\nEncapsulamento para automação.\n\n\`\`\`suggestion\n${s.newCode}\n\`\`\``,
            commit_id: head_sha,
            path: file.filename,
            line: parseInt(s.line),
            side: "RIGHT"
          });
        } catch (e) {
          core.warning(`⚠️ Não foi possível comentar na linha ${s.line} de ${file.filename}. Pode estar fora do diff.`);
        }
      }
    }
  } catch (error) {
    core.setFailed(`❌ Erro Fatal: ${error.message}`);
  }
}
run();