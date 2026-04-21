// Offline conversational troubleshooter. One-shot question -> LLM reply.
// Uses local Ollama; no cloud, no Claude, no data exfil.
//
// Usage:
//   node ask.js "why might my quad fail arming after a BLHeli update?"
//   node ask.js --model qwen2.5:7b "...question..."
//
// Env:
//   OLLAMA_HOST   override daemon URL (default http://127.0.0.1:11434)
//   LLM_MODEL     default model name (default llama3.1:8b)

const fs = require('fs');
const path = require('path');
const { printBanner } = require('./lib/banner');
const ollama = require('./lib/ollama-client');

async function main() {
  printBanner();

  const args = process.argv.slice(2);
  let model = process.env.LLM_MODEL || 'llama3.1:8b';
  const qParts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i+1]) { model = args[++i]; continue; }
    qParts.push(args[i]);
  }
  const question = qParts.join(' ').trim();

  if (!question) {
    console.log('  Usage: node ask.js "<your question>"');
    console.log('         node ask.js --model qwen2.5:7b "<question>"');
    process.exit(1);
  }

  console.log('  Checking Ollama at ' + ollama.HOST + '...');
  if (!(await ollama.isAvailable())) {
    console.error('\n  Ollama is not reachable at ' + ollama.HOST);
    console.error('  Install:  https://ollama.com/download');
    console.error('  Start:    run `ollama serve` (or launch the Ollama app)');
    console.error('  Pull:     `ollama pull ' + model + '`');
    process.exit(1);
  }

  const models = await ollama.listModels();
  if (!models.includes(model)) {
    console.error(`\n  Model "${model}" not installed. Available: ${models.join(', ') || '(none)'}`);
    console.error(`  Pull it with:  ollama pull ${model}`);
    process.exit(1);
  }

  const systemPromptPath = path.join(__dirname, 'llm', 'prompts', 'system.md');
  const systemPrompt = fs.existsSync(systemPromptPath) ? fs.readFileSync(systemPromptPath, 'utf8') : '';

  console.log(`  Model: ${model}`);
  console.log('  Thinking...\n');

  process.stdout.write('  ');
  await ollama.chatStream(
    model,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: question },
    ],
    (t) => process.stdout.write(t.replace(/\n/g, '\n  '))
  );
  console.log('\n');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
