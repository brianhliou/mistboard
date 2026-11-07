// node --import tsx scripts/three-kingdoms-net-study.ts [--compile games.jsonl | --plan file --public | --fill id]
// Local preview: --create --base http://localhost:<port> --dev-login <email>
import { runNetStudy } from './net-engine-study.js';

runNetStudy('three-kingdoms-banqi').catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
