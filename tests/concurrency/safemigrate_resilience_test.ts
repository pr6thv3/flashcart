import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface ResilienceTestResult {
  name: string;
  passed: boolean;
  expectedExitCode: number;
  actualExitCode: number;
  details?: string;
}

const SAFEMIGRATE_BIN = '/home/pr6thv3/flashcart_safemigrate_workspace/safemigrate/.venv/bin/safemigrate';
const MIGRATIONS_DIR = '/home/pr6thv3/flashcart_safemigrate_workspace/flashcart/migrations';
const TEMP_DIR = path.resolve(process.cwd(), 'tests/.temp_safemigrate_resilience');

function runSafeMigrate(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(SAFEMIGRATE_BIN, args, { encoding: 'utf8' });
  return {
    exitCode: result.status ?? (result.signal ? 128 : -1),
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

async function runResilienceTests(): Promise<boolean> {
  console.log('================================================================');
  console.log('SAFEMIGRATE CLI RESILIENCE & FORMAT VALIDATION SUITE');
  console.log('================================================================\n');

  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const results: ResilienceTestResult[] = [];

  // Helper to record and print result
  function record(name: string, passed: boolean, expectedExitCode: number, actualExitCode: number, details?: string) {
    results.push({ name, passed, expectedExitCode, actualExitCode, details });
    const status = passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${status}] ${name} (Exit code: ${actualExitCode}, expected: ${expectedExitCode})`);
    if (details) console.log(`       ${details}`);
  }

  // --------------------------------------------------------------------------
  // SUITE 1: Multi-Format Verification on FlashCart Baseline Migrations
  // --------------------------------------------------------------------------
  console.log('--- Suite 1: Format Resilience on Baseline Migrations ---');

  const formats = ['human', 'json', 'sarif', 'text'];
  for (const fmt of formats) {
    const res = runSafeMigrate([
      'scan',
      MIGRATIONS_DIR,
      '--format', fmt,
      '--fail-on', 'high',
      '--migration-transaction-mode', 'wrapped',
    ]);

    let formatValid = false;
    let formatDetails = '';

    if (res.exitCode === 0) {
      if (fmt === 'json') {
        try {
          const parsed = JSON.parse(res.stdout);
          formatValid = parsed && typeof parsed === 'object' && Array.isArray(parsed.findings);
          formatDetails = `Parsed JSON successfully: ${parsed.findings.length} findings, ${parsed.summary?.total_statements_analyzed} statements analyzed`;
        } catch (e: any) {
          formatDetails = `JSON parse failed: ${e.message}`;
        }
      } else if (fmt === 'sarif') {
        try {
          const parsed = JSON.parse(res.stdout);
          formatValid =
            parsed.version === '2.1.0' &&
            Array.isArray(parsed.runs) &&
            parsed.runs.length > 0 &&
            parsed.runs[0].tool?.driver?.name?.toLowerCase() === 'safemigrate';
          formatDetails = `OASIS SARIF 2.1.0 verified. Tool: ${parsed.runs[0].tool?.driver?.name}`;
        } catch (e: any) {
          formatDetails = `SARIF parse failed: ${e.message}`;
        }
      } else {
        // human or text format
        formatValid = res.stdout.length > 0;
        formatDetails = `Output length: ${res.stdout.length} chars`;
      }
    }

    record(`Format "${fmt}" scan baseline`, res.exitCode === 0 && formatValid, 0, res.exitCode, formatDetails);
  }

  // --------------------------------------------------------------------------
  // SUITE 2: Threshold Variation & Sensitivity on Baseline Migrations
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 2: Threshold Sensitivity on Baseline Migrations ---');
  // Baseline migrations have 0 critical, 0 high, and 56 medium findings (SM004 unconcurrent indexes for wrapped DDL)
  const thresholdExpectations: { threshold: string; expectedExitCode: number; reason: string }[] = [
    { threshold: 'critical', expectedExitCode: 0, reason: 'No critical findings (exit 0)' },
    { threshold: 'high', expectedExitCode: 0, reason: 'No high or critical findings (exit 0)' },
    { threshold: 'medium', expectedExitCode: 1, reason: '56 SM004 medium findings trigger policy (exit 1)' },
    { threshold: 'low', expectedExitCode: 1, reason: '56 SM004 medium findings trigger policy (exit 1)' },
    { threshold: 'info', expectedExitCode: 1, reason: '56 SM004 medium findings trigger policy (exit 1)' },
  ];

  for (const { threshold, expectedExitCode, reason } of thresholdExpectations) {
    const res = runSafeMigrate([
      'scan',
      MIGRATIONS_DIR,
      '--fail-on', threshold,
      '--format', 'json',
      '--migration-transaction-mode', 'wrapped',
    ]);

    const passed = res.exitCode === expectedExitCode;
    record(`Threshold "--fail-on ${threshold}" (${reason})`, passed, expectedExitCode, res.exitCode);
  }

  // --------------------------------------------------------------------------
  // SUITE 3: Policy Failure Triggering (Exit Code 1)
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 3: Policy Failure & Gate Gating (Exit Code 1) ---');
  {
    // Test 3A: DROP TABLE fixture (SM001 - Critical)
    const dropTableFixture = path.join(TEMP_DIR, 'hazard_drop_table.sql');
    fs.writeFileSync(dropTableFixture, 'DROP TABLE users CASCADE;\n');

    const resDropTable = runSafeMigrate([
      'scan',
      dropTableFixture,
      '--fail-on', 'critical',
      '--format', 'json',
    ]);
    const jsonDropTable = JSON.parse(resDropTable.stdout || '{}');
    const hasSM001 = jsonDropTable.findings?.some((f: any) => f.rule_id === 'SM001');
    record(
      'SM001 DROP TABLE triggers Exit Code 1 on --fail-on critical',
      resDropTable.exitCode === 1 && hasSM001,
      1,
      resDropTable.exitCode,
      `Finding: ${jsonDropTable.findings?.[0]?.rule_id} (${jsonDropTable.findings?.[0]?.severity})`
    );

    // Test 3B: DROP COLUMN fixture (SM002 - High)
    const dropColFixture = path.join(TEMP_DIR, 'hazard_drop_col.sql');
    fs.writeFileSync(dropColFixture, 'ALTER TABLE users DROP COLUMN email;\n');

    const resDropCol = runSafeMigrate([
      'scan',
      dropColFixture,
      '--fail-on', 'high',
      '--format', 'json',
    ]);
    const jsonDropCol = JSON.parse(resDropCol.stdout || '{}');
    const hasSM002 = jsonDropCol.findings?.some((f: any) => f.rule_id === 'SM002');
    record(
      'SM002 DROP COLUMN triggers Exit Code 1 on --fail-on high',
      resDropCol.exitCode === 1 && hasSM002,
      1,
      resDropCol.exitCode,
      `Finding: ${jsonDropCol.findings?.[0]?.rule_id} (${jsonDropCol.findings?.[0]?.severity})`
    );

    // Test 3C: Sub-threshold pass (SM002 is high, but policy set to critical -> Exit Code 0)
    const resSubThreshold = runSafeMigrate([
      'scan',
      dropColFixture,
      '--fail-on', 'critical',
      '--format', 'json',
    ]);
    record(
      'Sub-threshold finding passes policy (SM002 High with --fail-on critical -> Exit Code 0)',
      resSubThreshold.exitCode === 0,
      0,
      resSubThreshold.exitCode
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 4: Fail-Closed Invalid Syntax / Args Precedence (Exit Code 2)
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 4: Fail-Closed & Error Handling (Exit Code 2) ---');
  {
    // Test 4A: Invalid command line argument value
    const resInvalidArg = runSafeMigrate([
      'scan',
      MIGRATIONS_DIR,
      '--fail-on', 'nonexistent_severity_level',
    ]);
    record(
      'Invalid CLI argument triggers Exit Code 2',
      resInvalidArg.exitCode === 2,
      2,
      resInvalidArg.exitCode,
      resInvalidArg.stderr.trim().split('\n')[0]
    );

    // Test 4B: Unparseable SQL syntax in migration file
    const syntaxErrFixture = path.join(TEMP_DIR, 'corrupt_syntax.sql');
    fs.writeFileSync(syntaxErrFixture, 'CREATE TABLE users ( id UUID %%% MALFORMED SYNTAX %%% );\n');

    const resSyntaxErr = runSafeMigrate([
      'scan',
      syntaxErrFixture,
      '--fail-on', 'high',
      '--format', 'json',
    ]);
    record(
      'Unparseable SQL syntax triggers fail-closed Exit Code 2',
      resSyntaxErr.exitCode === 2,
      2,
      resSyntaxErr.exitCode,
      `Output: ${resSyntaxErr.stderr.trim().split('\n')[0] || resSyntaxErr.stdout.trim().split('\n')[0]}`
    );

    // Test 4C: Nonexistent input path
    const resMissingPath = runSafeMigrate([
      'scan',
      '/nonexistent/path/to/migration.sql',
    ]);
    record(
      'Nonexistent input file path triggers Exit Code 2',
      resMissingPath.exitCode === 2,
      2,
      resMissingPath.exitCode,
      resMissingPath.stderr.trim().split('\n')[0]
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 5: Output File Redirection (--output) & Determinism (--deterministic)
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 5: File Redirection & Deterministic Reports ---');
  {
    const jsonOutFile = path.join(TEMP_DIR, 'baseline_report.json');
    const sarifOutFile = path.join(TEMP_DIR, 'baseline_report.sarif');

    const resFileOut = runSafeMigrate([
      'scan',
      MIGRATIONS_DIR,
      '--format', 'json',
      '--output', jsonOutFile,
      '--deterministic',
    ]);

    const fileExists = fs.existsSync(jsonOutFile);
    let jsonContent: any = null;
    if (fileExists) {
      jsonContent = JSON.parse(fs.readFileSync(jsonOutFile, 'utf8'));
    }

    record(
      'JSON report successfully written to file via --output',
      resFileOut.exitCode === 0 && fileExists && jsonContent?.findings !== undefined,
      0,
      resFileOut.exitCode,
      `Written size: ${fileExists ? fs.statSync(jsonOutFile).size : 0} bytes`
    );

    // Determinism test: run second time, verify identical content
    const jsonOutFile2 = path.join(TEMP_DIR, 'baseline_report_2.json');
    runSafeMigrate([
      'scan',
      MIGRATIONS_DIR,
      '--format', 'json',
      '--output', jsonOutFile2,
      '--deterministic',
    ]);

    const content1 = fs.readFileSync(jsonOutFile, 'utf8');
    const content2 = fs.readFileSync(jsonOutFile2, 'utf8');
    const isDeterministic = content1 === content2;

    record(
      'Deterministic output: consecutive runs with --deterministic are bit-for-bit identical',
      isDeterministic,
      0,
      0,
      `Content match: ${isDeterministic} (bytes: ${content1.length})`
    );

    // SARIF file output test
    const resSarifOut = runSafeMigrate([
      'scan',
      MIGRATIONS_DIR,
      '--format', 'sarif',
      '--output', sarifOutFile,
    ]);
    const sarifExists = fs.existsSync(sarifOutFile);
    record(
      'SARIF report successfully written to file via --output',
      resSarifOut.exitCode === 0 && sarifExists,
      0,
      resSarifOut.exitCode,
      `Written size: ${sarifExists ? fs.statSync(sarifOutFile).size : 0} bytes`
    );
  }

  // Clean up temp directory
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  const totalPassed = results.filter((r) => r.passed).length;
  const allPassed = totalPassed === results.length;

  console.log('\n================================================================');
  console.log(`SAFEMIGRATE RESILIENCE SUMMARY: ${totalPassed}/${results.length} PASSED`);
  console.log(`VERDICT: ${allPassed ? 'ALL TESTS PASSED (APPROVED)' : 'TESTS FAILED (REQUEST CHANGES)'}`);
  console.log('================================================================\n');

  return allPassed;
}

runResilienceTests()
  .then((passed) => {
    if (!passed) process.exit(1);
  })
  .catch((err) => {
    console.error('FATAL RESILIENCE TEST ERROR:', err);
    process.exit(1);
  });
