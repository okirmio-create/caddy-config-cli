import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, writeFileSync, appendFileSync } from 'fs';

const CADDYFILE = 'Caddyfile';

const program = new Command();

program
  .name('caddy-config')
  .description('Generate Caddy web server configurations (Caddyfile)')
  .version('1.0.0');

// ── helpers ──────────────────────────────────────────────────────────────────

function appendBlock(block: string, label: string): void {
  if (existsSync(CADDYFILE)) {
    appendFileSync(CADDYFILE, '\n' + block);
    console.log(chalk.green(`✔ Appended ${label} block to ${CADDYFILE}`));
  } else {
    writeFileSync(CADDYFILE, block);
    console.log(chalk.green(`✔ Created ${CADDYFILE} with ${label} block`));
  }
}

// ── init <domain> ─────────────────────────────────────────────────────────────

program
  .command('init <domain>')
  .description('Generate Caddyfile with automatic HTTPS and sensible defaults')
  .option('--email <email>', 'ACME email address for TLS certificate notifications')
  .option('--log-file <path>', 'Log output file path', '/var/log/caddy/access.log')
  .option('--log-format <format>', 'Log format (json|console)', 'json')
  .option('-f, --force', 'Overwrite existing Caddyfile')
  .action((domain: string, opts) => {
    if (existsSync(CADDYFILE) && !opts.force) {
      console.error(chalk.red(`Error: ${CADDYFILE} already exists. Use --force to overwrite.`));
      process.exit(1);
    }

    const lines: string[] = [];

    // Global options block
    lines.push('{');
    if (opts.email) {
      lines.push(`\temail ${opts.email}`);
    }
    lines.push('\tadmin off');
    lines.push('}');
    lines.push('');

    // Site block
    lines.push(`${domain} {`);
    lines.push('');

    // Logging
    lines.push('\tlog {');
    lines.push(`\t\toutput file ${opts.logFile}`);
    lines.push(`\t\tformat ${opts.logFormat}`);
    lines.push('\t}');
    lines.push('');

    // Security headers
    lines.push('\theader {');
    lines.push('\t\tStrict-Transport-Security "max-age=31536000; includeSubDomains; preload"');
    lines.push('\t\tX-Content-Type-Options nosniff');
    lines.push('\t\tX-Frame-Options DENY');
    lines.push('\t\tX-XSS-Protection "1; mode=block"');
    lines.push('\t\tReferrer-Policy strict-origin-when-cross-origin');
    lines.push('\t}');
    lines.push('');

    lines.push('\tencode gzip');
    lines.push('');
    lines.push('\trespond "Caddy is running. Configure your site blocks." 200');
    lines.push('}');
    lines.push('');

    writeFileSync(CADDYFILE, lines.join('\n'));
    console.log(chalk.green(`✔ Created ${CADDYFILE}`));
    console.log(chalk.dim(`  domain: ${domain}`));
    console.log(chalk.dim(`  TLS: automatic (ACME)`));
    if (opts.email) console.log(chalk.dim(`  email: ${opts.email}`));
  });

// ── reverse-proxy <upstream> ──────────────────────────────────────────────────

program
  .command('reverse-proxy <upstream>')
  .description('Add reverse proxy with load balancing and health checks')
  .option('-d, --domain <domain>', 'Domain name for the site block', 'localhost')
  .option('--health-path <path>', 'Health check URI path', '/health')
  .option('--health-interval <dur>', 'Health check interval', '10s')
  .option('--health-timeout <dur>', 'Health check timeout', '5s')
  .option('--health-status <code>', 'Expected HTTP status code for healthy upstream', '200')
  .option('--lb-policy <policy>', 'Load balancing policy: round_robin|least_conn|random|first|ip_hash', 'round_robin')
  .option('--max-fails <n>', 'Max consecutive failures before marking unhealthy', '3')
  .option('--fail-duration <dur>', 'How long to mark upstream unhealthy after max-fails', '30s')
  .option('--cb-errors <n>', 'Circuit breaker: consecutive error threshold', '5')
  .option('--trusted-proxies <cidrs>', 'Comma-separated trusted proxy CIDRs for IP forwarding')
  .action((upstream: string, opts) => {
    const upstreams = upstream.split(',').map(u => u.trim());
    const lines: string[] = [];

    lines.push(`${opts.domain} {`);
    lines.push(`\treverse_proxy ${upstreams.join(' ')} {`);
    lines.push('\t\theader_up Host {upstream_hostport}');
    lines.push('\t\theader_up X-Real-IP {remote_host}');
    lines.push('\t\theader_up X-Forwarded-For {remote_host}');
    lines.push('\t\theader_up X-Forwarded-Proto {scheme}');
    lines.push('');
    lines.push(`\t\tlb_policy ${opts.lbPolicy}`);
    lines.push(`\t\tlb_try_duration 5s`);
    lines.push(`\t\tlb_try_interval 250ms`);
    lines.push('');
    lines.push('\t\thealth_uri ' + opts.healthPath);
    lines.push('\t\thealth_interval ' + opts.healthInterval);
    lines.push('\t\thealth_timeout ' + opts.healthTimeout);
    lines.push('\t\thealth_status ' + opts.healthStatus);
    lines.push('');
    lines.push(`\t\tfail_duration ${opts.failDuration}`);
    lines.push(`\t\tmax_fails ${opts.maxFails}`);
    lines.push('');
    lines.push(`\t\tcircuit_breaker error_count ${opts.cbErrors} 10s 5s`);
    lines.push('\t}');
    lines.push('}');
    lines.push('');

    appendBlock(lines.join('\n'), 'reverse-proxy');
    console.log(chalk.dim(`  ${opts.domain} → ${upstream}`));
    console.log(chalk.dim(`  lb: ${opts.lbPolicy}, health: ${opts.healthPath} every ${opts.healthInterval}`));
  });

// ── php ───────────────────────────────────────────────────────────────────────

program
  .command('php')
  .description('Generate PHP-FPM FastCGI configuration')
  .option('-d, --domain <domain>', 'Domain name for the site block', 'localhost')
  .option('-r, --root <path>', 'Document root path', '/var/www/html')
  .option('--fpm-socket <socket>', 'PHP-FPM socket (unix socket or tcp address)', 'unix//run/php/php-fpm.sock')
  .option('--index <file>', 'PHP index file', 'index.php')
  .option('--split-path <path>', 'Split path for PHP execution', '.php')
  .option('--env <vars>', 'Comma-separated FastCGI env vars (KEY=VALUE)')
  .option('--max-upload <size>', 'Max upload size for PHP', '100M')
  .action((opts) => {
    const lines: string[] = [];
    const envVars = opts.env ? opts.env.split(',').map((e: string) => e.trim()) : [];

    lines.push(`${opts.domain} {`);
    lines.push(`\troot * ${opts.root}`);
    lines.push('');
    lines.push('\tencode gzip');
    lines.push('');
    lines.push('\t# Deny access to sensitive files');
    lines.push('\t@sensitive {');
    lines.push('\t\tpath /.git/* /composer.* /.env* /*.log');
    lines.push('\t}');
    lines.push('\trespond @sensitive 403');
    lines.push('');
    lines.push(`\tphp_fastcgi ${opts.fpmSocket} {`);
    lines.push(`\t\tindex ${opts.index}`);
    lines.push(`\t\tsplit ${opts.splitPath}`);
    lines.push('');
    lines.push('\t\t# FastCGI environment variables');
    lines.push('\t\tenv SCRIPT_FILENAME {document_root}{path_info}');
    lines.push(`\t\tenv PHP_VALUE "upload_max_filesize=${opts.maxUpload}\\npost_max_size=${opts.maxUpload}"`);
    envVars.forEach((pair: string) => {
      const [key, val] = pair.split('=');
      if (key && val) lines.push(`\t\tenv ${key} ${val}`);
    });
    lines.push('\t}');
    lines.push('');
    lines.push('\tfile_server');
    lines.push('}');
    lines.push('');

    appendBlock(lines.join('\n'), 'php-fpm');
    console.log(chalk.dim(`  domain: ${opts.domain}, root: ${opts.root}`));
    console.log(chalk.dim(`  FPM socket: ${opts.fpmSocket}`));
  });

// ── static <root> ─────────────────────────────────────────────────────────────

program
  .command('static <root>')
  .description('Configure static file serving with gzip compression')
  .option('-d, --domain <domain>', 'Domain name for the site block', 'localhost')
  .option('--no-browse', 'Disable directory listing')
  .option('--no-gzip', 'Disable gzip compression')
  .option('--try-files <pattern>', 'try_files fallback pattern', '{path} /index.html')
  .option('--cache-max-age <seconds>', 'Cache-Control max-age for static assets', '86400')
  .option('--spa', 'Enable SPA mode (serves index.html for all routes)')
  .option('--exclude <patterns>', 'Comma-separated path patterns to exclude from file server')
  .action((root: string, opts) => {
    const lines: string[] = [];
    const excludePatterns = opts.exclude ? opts.exclude.split(',').map((p: string) => p.trim()) : [];

    lines.push(`${opts.domain} {`);
    lines.push(`\troot * ${root}`);
    lines.push('');

    if (opts.gzip !== false) {
      lines.push('\tencode gzip brotli {');
      lines.push('\t\tminimum_length 1024');
      lines.push('\t}');
      lines.push('');
    }

    // Cache headers for static assets
    lines.push('\t@static {');
    lines.push('\t\tfile');
    lines.push('\t\tpath *.css *.js *.png *.jpg *.jpeg *.gif *.ico *.svg *.woff *.woff2 *.ttf *.eot');
    lines.push('\t}');
    lines.push(`\theader @static Cache-Control "public, max-age=${opts.cacheMaxAge}, immutable"`);
    lines.push('');

    if (excludePatterns.length > 0) {
      lines.push('\t@excluded {');
      excludePatterns.forEach((p: string) => lines.push(`\t\tpath ${p}`));
      lines.push('\t}');
      lines.push('\trespond @excluded 404');
      lines.push('');
    }

    if (opts.spa) {
      lines.push('\ttry_files {path} /index.html');
    } else {
      lines.push(`\ttry_files ${opts.tryFiles}`);
    }
    lines.push('');

    if (opts.browse !== false) {
      lines.push('\tfile_server browse');
    } else {
      lines.push('\tfile_server');
    }

    lines.push('}');
    lines.push('');

    appendBlock(lines.join('\n'), 'static');
    console.log(chalk.dim(`  ${opts.domain} → ${root}`));
    console.log(chalk.dim(`  gzip: ${opts.gzip !== false}, browse: ${opts.browse !== false}, spa: ${!!opts.spa}`));
  });

// ── auth <type> ───────────────────────────────────────────────────────────────

program
  .command('auth <type>')
  .description('Add authentication: basic_auth | forward_auth | mtls')
  .option('-d, --domain <domain>', 'Domain name for the site block', 'localhost')
  // basic_auth options
  .option('--user <user>', 'Username for basic_auth')
  .option('--hash <hash>', 'bcrypt password hash for basic_auth')
  .option('--realm <realm>', 'Basic auth realm', 'Restricted')
  // forward_auth options
  .option('--auth-url <url>', 'Forward auth server URL')
  .option('--auth-path <path>', 'Auth verification path', '/auth/verify')
  .option('--copy-headers <headers>', 'Comma-separated response headers to copy from auth server', 'Remote-User,Remote-Groups,Remote-Name,Remote-Email')
  .option('--trusted <cidrs>', 'Comma-separated trusted CIDRs for forward auth')
  // mtls options
  .option('--ca <path>', 'Path to CA certificate file for mTLS')
  .option('--verify-mode <mode>', 'TLS client verification: require|request|none', 'require')
  .action((type: string, opts) => {
    const validTypes = ['basic_auth', 'forward_auth', 'mtls'];
    if (!validTypes.includes(type)) {
      console.error(chalk.red(`Error: Unknown auth type "${type}". Valid types: ${validTypes.join(', ')}`));
      process.exit(1);
    }

    const lines: string[] = [];

    lines.push(`${opts.domain} {`);

    if (type === 'basic_auth') {
      if (!opts.user || !opts.hash) {
        console.error(chalk.red('Error: basic_auth requires --user and --hash'));
        console.error(chalk.dim('  Generate hash with: caddy hash-password --plaintext yourpassword'));
        process.exit(1);
      }
      lines.push(`\tbasicauth /* {`);
      lines.push(`\t\t# realm ${opts.realm}`);
      lines.push(`\t\t${opts.user} ${opts.hash}`);
      lines.push('\t}');
    } else if (type === 'forward_auth') {
      if (!opts.authUrl) {
        console.error(chalk.red('Error: forward_auth requires --auth-url'));
        process.exit(1);
      }
      const copyHeaders = opts.copyHeaders.split(',').map((h: string) => h.trim());
      lines.push(`\tforward_auth ${opts.authUrl} {`);
      lines.push(`\t\turi ${opts.authPath}`);
      lines.push(`\t\tcopy_headers ${copyHeaders.join(' ')}`);
      if (opts.trusted) {
        const cidrs = opts.trusted.split(',').map((c: string) => c.trim());
        lines.push(`\t\ttrusted_proxies ${cidrs.join(' ')}`);
      }
      lines.push('\t}');
    } else if (type === 'mtls') {
      if (!opts.ca) {
        console.error(chalk.red('Error: mtls requires --ca <path>'));
        process.exit(1);
      }
      lines.push('\ttls {');
      lines.push(`\t\tclient_auth {`);
      lines.push(`\t\t\tmode ${opts.verifyMode}`);
      lines.push(`\t\t\ttrusted_ca_certs ${opts.ca}`);
      lines.push('\t\t}');
      lines.push('\t}');
    }

    lines.push('');
    lines.push('\t# Add your site directives here');
    lines.push('\treverse_proxy localhost:8080');
    lines.push('}');
    lines.push('');

    appendBlock(lines.join('\n'), `auth:${type}`);
    console.log(chalk.dim(`  domain: ${opts.domain}, type: ${type}`));
  });

// ── tls <mode> ────────────────────────────────────────────────────────────────

program
  .command('tls <mode>')
  .description('Configure TLS: automatic | custom | internal | on-demand')
  .option('-d, --domain <domain>', 'Domain name for the site block', 'localhost')
  // custom cert options
  .option('--cert <path>', 'Path to TLS certificate file (.pem)')
  .option('--key <path>', 'Path to TLS private key file (.pem)')
  // on-demand options
  .option('--ask-url <url>', 'URL to ask before issuing on-demand TLS cert')
  .option('--interval <dur>', 'Minimum interval between on-demand issuances', '2m')
  .option('--burst <n>', 'Max on-demand cert issuances in interval', '5')
  // internal CA options
  .option('--ca-name <name>', 'Internal CA name', 'local')
  // common options
  .option('--protocols <range>', 'Min and max TLS protocol versions (e.g. tls1.2 tls1.3)', 'tls1.2 tls1.3')
  .option('--ciphers <list>', 'Comma-separated allowed cipher suites')
  .option('--curves <list>', 'Comma-separated allowed key exchange curves', 'x25519,p256,p384')
  .action((mode: string, opts) => {
    const validModes = ['automatic', 'custom', 'internal', 'on-demand'];
    if (!validModes.includes(mode)) {
      console.error(chalk.red(`Error: Unknown TLS mode "${mode}". Valid modes: ${validModes.join(', ')}`));
      process.exit(1);
    }

    const lines: string[] = [];
    const [minProto, maxProto] = opts.protocols.split(' ');
    const curves = opts.curves.split(',').map((c: string) => c.trim());

    lines.push(`${opts.domain} {`);
    lines.push('\ttls {');

    if (mode === 'automatic') {
      lines.push('\t\t# Automatic ACME TLS (default Caddy behavior)');
      lines.push(`\t\tprotocols ${minProto} ${maxProto || minProto}`);
      lines.push(`\t\tcurves ${curves.join(' ')}`);
      if (opts.ciphers) {
        const ciphers = opts.ciphers.split(',').map((c: string) => c.trim());
        lines.push(`\t\tciphers ${ciphers.join(' ')}`);
      }
    } else if (mode === 'custom') {
      if (!opts.cert || !opts.key) {
        console.error(chalk.red('Error: custom TLS mode requires --cert and --key'));
        process.exit(1);
      }
      lines.push(`\t\t${opts.cert} ${opts.key}`);
      lines.push(`\t\tprotocols ${minProto} ${maxProto || minProto}`);
      lines.push(`\t\tcurves ${curves.join(' ')}`);
      if (opts.ciphers) {
        const ciphers = opts.ciphers.split(',').map((c: string) => c.trim());
        lines.push(`\t\tciphers ${ciphers.join(' ')}`);
      }
    } else if (mode === 'internal') {
      lines.push(`\t\tinternal {`);
      lines.push(`\t\t\tca ${opts.caName}`);
      lines.push('\t\t}');
      lines.push(`\t\tprotocols ${minProto} ${maxProto || minProto}`);
    } else if (mode === 'on-demand') {
      if (!opts.askUrl) {
        console.error(chalk.red('Error: on-demand TLS requires --ask-url'));
        process.exit(1);
      }
      lines.push('\t\ton_demand');
    }

    lines.push('\t}');
    lines.push('');

    if (mode === 'on-demand') {
      lines.push('\t# on_demand TLS global config must be placed in the global options block:');
      lines.push('\t# {');
      lines.push('\t#   on_demand_tls {');
      lines.push(`\t#     ask ${opts.askUrl}`);
      lines.push(`\t#     interval ${opts.interval}`);
      lines.push(`\t#     burst ${opts.burst}`);
      lines.push('\t#   }');
      lines.push('\t# }');
      lines.push('');
    }

    lines.push('\t# Add your site directives here');
    lines.push('\treverse_proxy localhost:8080');
    lines.push('}');
    lines.push('');

    appendBlock(lines.join('\n'), `tls:${mode}`);
    console.log(chalk.dim(`  domain: ${opts.domain}, mode: ${mode}`));
    if (mode === 'custom') {
      console.log(chalk.dim(`  cert: ${opts.cert}, key: ${opts.key}`));
    } else if (mode === 'on-demand') {
      console.log(chalk.dim(`  ask: ${opts.askUrl}, interval: ${opts.interval}`));
    }
  });

program.parse();
