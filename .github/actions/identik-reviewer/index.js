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

      // Adiciona números de linha para a IA se localizar perfeitamente
      const contentWithLines = rawContent.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');

      const prompt = `Você é um especialista em Flutter. Analise o código fornecido (que possui números de linha).
Identifique widgets interativos (Buttons, TextFields, InkWell, GestureDetector) que NÃO estão envolvidos por 'Identik'.

REGRAS RÍGIDAS:
1. NÃO mude a lógica interna (onPressed, validações, etc). Mantenha EXATAMENTE igual.
2. Identifique a linha de INÍCIO e a linha de FIM do widget completo.
3. O 'newCode' deve ser o widget original (sem os números de linha) envolvido por: Identik(id: 'prefixo_nome', label: 'Rótulo', child: ...).
4. Use prefixos: btn_, input_, ic_, txt_.

Retorne APENAS JSON:
{"suggestions": [{"startLine": 45, "endLine": 52, "newCode": "Identik(...)"}]}`;

      core.info(`🤖 Analisando com precisão: ${file.filename}`);
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: prompt }, { role: "user", content: contentWithLines }],
        response_format: { type: "json_object" },
        temperature: 0
      });

      const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');

      for (const s of result.suggestions) {
        try {
          // Criamos um comentário multi-linha no GitHub para substituir o bloco correto
          await octokit.rest.pulls.createReviewComment({
            owner, repo, pull_number,
            body: `🤖 **Identik AI Review**\nEncapsulando widget para automação.\n\n\`\`\`suggestion\n${s.newCode}\n\`\`\``,
            commit_id: head_sha,
            path: file.filename,
            line: parseInt(s.endLine), // Linha final do bloco
            start_line: parseInt(s.startLine), // Linha inicial do bloco
            side: "RIGHT"
          });
        } catch (e) {
          core.warning(`⚠️ Falha na sugestão das linhas ${s.startLine}-${s.endLine}: ${e.message}`);
        }
      }
    }
  } catch (error) {
    core.setFailed(`❌ Erro: ${error.message}`);
  }
}
run();