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

      // PROMPT REFORMULADO PARA PRECISÃO
      const prompt = `Você é um especialista em Flutter e QA. Analise o código fornecido.
Sua tarefa é encontrar widgets interativos (Buttons, TextFields, InkWell, GestureDetector) que NÃO possuem o wrapper 'Identik'.

REGRAS DE OURO:
1. Mantenha EXATAMENTE a mesma lógica e parâmetros do widget original. NÃO invente lógica extra.
2. O campo 'oldCode' deve ser o trecho de código ORIGINAL que será substituído.
3. O campo 'newCode' deve ser o widget original envolvido por: Identik(id: 'prefixo_nome', label: 'Rótulo descritivo', child: WIDGET_ORIGINAL).
4. Use prefixos: btn_, input_, ic_, txt_.
5. Identifique a linha de INÍCIO correta do widget.

Responda APENAS com JSON:
{"suggestions": [{"line": 45, "oldCode": "TextButton(...)", "newCode": "Identik(...)"}]}`;

      core.info(`🤖 Analisando ${file.filename}...`);
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: prompt }, { role: "user", content }],
        response_format: { type: "json_object" },
        temperature: 0 // Zero criatividade, foco total em precisão
      });

      const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');

      for (const s of result.suggestions) {
        try {
          await octokit.rest.pulls.createReviewComment({
            owner, repo, pull_number,
            body: `🤖 **Identik AI Review**\nSugestão de encapsulamento para automação.\n\n\`\`\`suggestion\n${s.newCode}\n\`\`\``,
            commit_id: head_sha,
            path: file.filename,
            line: parseInt(s.line),
            side: "RIGHT"
          });
        } catch (e) {
          core.error(`❌ Falha ao comentar na linha ${s.line}: ${e.message}`);
        }
      }
    }
  } catch (error) {
    core.setFailed(`❌ Erro: ${error.message}`);
  }
}
run();