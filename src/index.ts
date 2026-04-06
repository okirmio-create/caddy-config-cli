import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';

const CADDYFILE = 'Caddyfile';

const program = new Command();

program
  .name('caddy-config')
  .description('CLI tool to generate Caddy web server configuration files')
  .version('1.0.0');

// ── init ────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Create a Caddyfile with configurable options')
  .option('-d, --domain <domain>', 'Primary domain name', 'localhost')
  .option('-p, --proxy <upstream>', 'Reverse proxy upstream URL')
  .option('-r, --root <path>', 'Static file root directory')
  .option('--tls-email <email>', 'TLS ACME email address')
  .option('--no-tls', 'Disable automatic TLS')
  .option('--log-file <path>', 'Log output file path', '/var/log/caddy/access.log')
  .option('--log-format <format>', 'Log format (json|console)', 'json')
  .option('-f, --force', 'Overwrite existing Caddyfile')
  .action((opts) => {
    if (existsSync(CADDYFILE) && !opts.force) {
      console.error(chalk.red(`Error: ${CADDYFILE} already exists. Use --force to overwrite.`));
      process.exit(1);
    }

    const lines: string[] = [];

    // Global options block
    lines.push('{');
    if (opts.tlsEmail) {
      lines.push(`\temail ${opts.tlsEmail}`);
    }
    if (!opts.tls) {
      lines.push('\tauto_https off');
    }
    lines.push('}');
    lines.push('');

    // Site block
    const site = opts.tls === false ? `http://${opts.domain}` : opts.domain;
    lines.push(`${site} {`);

    // Logging
    lines.push(`\tlog {`);
    lines.push(`\t\toutput file ${opts.logFile}`);
    lines.push(`\t\tformat ${opts.logFormat}`);
    lines.push(`\t}`);
    lines.push('');

    // Reverse proxy
    if (opts.proxy) {
      lines.push(`\treverse_proxy ${opts.proxy} {`);
      lines.push('\t\theader_up Host {host}');
      lines.push('\t\theader_up X-Real-IP {remote_host}');
      lines.push('\t\theader_up X-Forwarded-For {remote_host}');
      lines.push('\t\theader_up X-Forwarded-Proto {scheme}');
      lines.push('\t}');
      lines.push('');
    }

    // Static files
    if (opts.root) {
      lines.push(`\troot * ${opts.root}`);
      lines.push('\tencode gzip');
      lines.push('\ttry_files {path} /index.html');
      lines.push('\tfile_server browse');
      lines.push('');
    }

    lines.push('}');
    lines.push('');

    writeFileSync(CADDYFILE, lines.join('\n'));
    console.log(chalk.green(`✔ Created ${CADDYFILE}`));
    console.log(chalk.dim(`  domain: ${site}`));
    if (opts.proxy) console.log(chalk.dim(`  proxy → ${opts.proxy}`));
    if (opts.root) console.log(chalk.dim(`  static root: ${opts.root}`));
  });

// ── proxy ───────────────────────────────────────────────────────────────────

program
  .command('proxy <domain> <upstream>')
  .description('Add a reverse proxy block to Caddyfile')
  .option('--health-path <path>', 'Health check path', '/health')
  .option('--health-interval <duration>', 'Health check interval', '10s')
  .option('--health-timeout <duration>', 'Health check timeout', '5s')
  .option('--lb-policy <policy>', 'Load balancing policy (round_robin|least_conn|random|first|ip_hash)', 'round_robin')
  .option('--max-fails <n>', 'Max fails before marking upstream unhealthy', '3')
  .option('--fail-duration <duration>', 'Duration to mark upstream unhealthy', '30s')
  .action((domain: string, upstream: string, opts) => {
    const lines: string[] = [];

    lines.push(`${domain} {`);
    lines.push(`\treverse_proxy ${upstream} {`);
    lines.push('\t\theader_up Host {host}');
    lines.push('\t\theader_up X-Real-IP {remote_host}');
    lines.push('\t\theader_up X-Forwarded-For {remote_host}');
    lines.push('\t\theader_up X-Forwarded-Proto {scheme}');
    lines.push('');
    lines.push(`\t\tlb_policy ${opts.lbPolicy}`);
    lines.push('');
    lines.push('\t\thealth_checks {');
    lines.push(`\t\t\tpath ${opts.healthPath}`);
    lines.push(`\t\t\tinterval ${opts.healthInterval}`);
    lines.push(`\t\t\ttimeout ${opts.healthTimeout}`);
    lines.push('\t\t}');
    lines.push('');
    lines.push(`\t\tfail_duration ${opts.failDuration}`);
    lines.push(`\t\tmax_fails ${opts.maxFails}`);
    lines.push('\t}');
    lines.push('}');
    lines.push('');

    const block = lines.join('\n');

    if (existsSync(CADDYFILE)) {
      appendFileSync(CADDYFILE, '\n' + block);
      console.log(chalk.green(`✔ Appended proxy block to ${CADDYFILE}`));
    } else {
      writeFileSync(CADDYFILE, block);
      console.log(chalk.green(`✔ Created ${CADDYFILE} with proxy block`));
    }

    console.log(chalk.dim(`  ${domain} → ${upstream}`));
    console.log(chalk.dim(`  lb: ${opts.lbPolicy}, health: ${opts.healthPath} every ${opts.healthInterval}`));
  });

// ── static ──────────────────────────────────────────────────────────────────

program
  .command('static <domain> <root>')
  .description('Add a static file serving block to Caddyfile')
  .option('--no-browse', 'Disable directory browsing')
  .option('--no-gzip', 'Disable gzip compression')
  .option('--try-files <pattern>', 'try_files fallback pattern', '{path} /index.html')
  .option('--index <file>', 'Index file name', 'index.html')
  .action((domain: string, root: string, opts) => {
    const lines: string[] = [];

    lines.push(`${domain} {`);
    lines.push(`\troot * ${root}`);
    lines.push('');

    if (opts.gzip !== false) {
      lines.push('\tencode gzip');
      lines.push('');
    }

    lines.push(`\ttry_files ${opts.tryFiles}`);
    lines.push('');

    if (opts.browse !== false) {
      lines.push('\tfile_server browse');
    } else {
      lines.push('\tfile_server');
    }

    lines.push('}');
    lines.push('');

    const block = lines.join('\n');

    if (existsSync(CADDYFILE)) {
      appendFileSync(CADDYFILE, '\n' + block);
      console.log(chalk.green(`✔ Appended static block to ${CADDYFILE}`));
    } else {
      writeFileSync(CADDYFILE, block);
      console.log(chalk.green(`✔ Created ${CADDYFILE} with static block`));
    }

    console.log(chalk.dim(`  ${domain} → ${root}`));
    console.log(chalk.dim(`  gzip: ${opts.gzip !== false}, browse: ${opts.browse !== false}`));
  });

program.parse();
