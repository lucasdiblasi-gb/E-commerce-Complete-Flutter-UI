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

      // Numeração de linhas para a IA se localizar perfeitamente
      const contentWithLines = rawContent.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');

      const prompt = `Você é um especialista em Flutter, Acessibilidade e Clean Code.
Analise o código fornecido que possui números de linha e identifique widgets interativos (Buttons, TextFields, InkWell, GestureDetector, Switches) que NÃO estão envolvidos pelo wrapper 'Identik'.

REGRAS DE CONTEÚDO (ACESSIBILIDADE E AUTOMAÇÃO):
1. 'label': Traduza para PORTUGUÊS BRASILEIRO. Seja conciso (ex: 'Log in' vira 'Entrar'). FOCO: TalkBack.
2. 'id': Use snake_case com prefixos: btn_, input_, ic_, txt_.
3. 'button': Se o widget for um botão (ElevatedButton, TextButton, IconButton, etc.), adicione obrigatoriamente 'button: true'.
4. Mantenha a lógica original (onPressed, validações) EXATAMENTE como está.

REGRAS DE FORMATAÇÃO (ANTI-LINTER):
1. Gere o 'newCode' com indentação MULTI-LINHA (padrão Dart).
2. O widget Identik deve envolver o widget original de forma que cada parâmetro fique em uma nova linha para evitar erros de linter.

Retorne APENAS JSON:
{"suggestions": [{
  "startLine": 45, 
  "endLine": 52, 
  "newCode": "Identik(\\n  id: 'btn_exemplo',\\n  label: 'Texto em PT',\\n  button: true,\\n  child: WidgetOriginal(\\n    ...\\n  ),\\n)"
}]}`;

      core.info(`🆔 Analisando arquivo: ${file.filename}`);
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Arquivo: ${file.filename}\n\n${contentWithLines}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0
      });

      const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');

      for (const s of result.suggestions) {
        try {
          await octokit.rest.pulls.createReviewComment({
            owner, repo, pull_number,
            body: `🆔 **Identik AI Review**\nEncapsulamento para automação e acessibilidade (TalkBack PT-BR).\n\n\`\`\`suggestion\n${s.newCode}\n\`\`\``,
            commit_id: head_sha,
            path: file.filename,
            line: parseInt(s.endLine), 
            start_line: parseInt(s.startLine),
            side: "RIGHT"
          });
        } catch (e) {
          core.warning(`⚠️ Falha na sugestão das linhas ${s.startLine}-${s.endLine}: ${e.message}`);
        }
      }
    }
    core.info("🚀 Revisão concluída!");
  } catch (error) {
    core.setFailed(`❌ Erro Fatal: ${error.message}`);
  }
}
run();