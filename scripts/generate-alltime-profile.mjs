import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const toolDir = path.join(repoRoot, '.cache/github-profile-3d-contrib');
const outputPath = path.join(repoRoot, 'profile-3d-contrib/profile-night-green.svg');
const userInfoPath = path.join(repoRoot, '.cache/user-info.json');
const renderScriptPath = path.join(toolDir, 'alltime-render.ts');

const levelMap = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const renderScriptSource = `import * as fs from 'fs';
import * as path from 'path';
import * as create from './src/create-svg';
import * as template from './src/color-template';
import * as type from './src/type';

const userInfoPath = process.env.USER_INFO_PATH;
const outputPath = process.argv[2];

if (!userInfoPath || !outputPath) {
  console.error('USER_INFO_PATH and output path are required');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(userInfoPath, 'utf8')) as type.UserInfo & {
  contributionCalendar: Array<{
    contributionCount: number;
    contributionLevel: number;
    date: string;
  }>;
};

const userInfo: type.UserInfo = {
  ...raw,
  contributionCalendar: raw.contributionCalendar.map((day) => ({
    ...day,
    date: new Date(day.date),
  })),
};

let svg = create.createSvg(userInfo, template.NightGreenSettings, true);

svg = svg.replace(/<text[^>]*>\\d{4}-\\d{2}-\\d{2} \\/ \\d{4}-\\d{2}-\\d{2}<\\/text>/, '');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
`;

async function graphql(token, query, variables = {}) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message);
  }
  return payload;
}

function ensureTool() {
  if (!fs.existsSync(toolDir)) {
    execSync(
      `git clone --depth 1 https://github.com/yoshi389111/github-profile-3d-contrib.git "${toolDir}"`,
      { stdio: 'inherit' },
    );
  }

  execSync('npm ci', { cwd: toolDir, stdio: 'inherit' });

  const contribFile = path.join(toolDir, 'src/create-3d-contrib.ts');
  const contribSource = fs.readFileSync(contribFile, 'utf8');
  const scaledSource = contribSource.replace(
    'const dx = width / 64;',
    'const dx = width / Math.max(64, weekcount + 7);',
  );
  if (scaledSource !== contribSource) {
    fs.writeFileSync(contribFile, scaledSource);
  }

  fs.writeFileSync(renderScriptPath, renderScriptSource);
}

function mergeLanguages(collections) {
  const languages = {};

  for (const collection of collections) {
    for (const repo of collection.commitContributionsByRepository) {
      const primaryLanguage = repo.repository.primaryLanguage;
      if (!primaryLanguage) continue;

      const existing = languages[primaryLanguage.name];
      if (existing) {
        existing.contributions += repo.contributions.totalCount;
      } else {
        languages[primaryLanguage.name] = {
          language: primaryLanguage.name,
          color: primaryLanguage.color || '#444444',
          contributions: repo.contributions.totalCount,
        };
      }
    }
  }

  return Object.values(languages).sort(
    (a, b) => b.contributions - a.contributions,
  );
}

async function fetchAllTimeUserInfo(username, token) {
  const baseQuery = `
    query($login: String!) {
      user(login: $login) {
        createdAt
        repositories(first: 100, ownerAffiliations: OWNER) {
          nodes {
            forkCount
            stargazerCount
          }
        }
      }
    }
  `;

  const base = await graphql(token, baseQuery, { login: username });
  const createdAt = base.data.user.createdAt.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const startYear = new Date(createdAt).getFullYear();
  const endYear = new Date().getFullYear();
  const years = Array.from(
    { length: endYear - startYear + 1 },
    (_, index) => startYear + index,
  );

  const daysByDate = new Map();
  const collections = [];
  let totalContributions = 0;
  let isHalloween = false;
  let totalCommitContributions = 0;
  let totalIssueContributions = 0;
  let totalPullRequestContributions = 0;
  let totalPullRequestReviewContributions = 0;
  let totalRepositoryContributions = 0;

  for (const year of years) {
    const from =
      year === years[0] ? `${createdAt}T00:00:00Z` : `${year}-01-01T00:00:00Z`;
    const to =
      year === years[years.length - 1]
        ? `${today}T23:59:59Z`
        : `${year}-12-31T23:59:59Z`;

    const yearQuery = `
      query($login: String!) {
        user(login: $login) {
          contributionsCollection(from: "${from}", to: "${to}") {
            contributionCalendar {
              isHalloween
              totalContributions
              weeks {
                contributionDays {
                  contributionCount
                  contributionLevel
                  date
                }
              }
            }
            commitContributionsByRepository(maxRepositories: 100) {
              repository {
                primaryLanguage {
                  name
                  color
                }
              }
              contributions {
                totalCount
              }
            }
            totalCommitContributions
            totalIssueContributions
            totalPullRequestContributions
            totalPullRequestReviewContributions
            totalRepositoryContributions
          }
        }
      }
    `;

    const result = await graphql(token, yearQuery, { login: username });
    const collection = result.data.user.contributionsCollection;
    collections.push(collection);

    totalContributions += collection.contributionCalendar.totalContributions;
    isHalloween ||= collection.contributionCalendar.isHalloween;
    totalCommitContributions += collection.totalCommitContributions;
    totalIssueContributions += collection.totalIssueContributions;
    totalPullRequestContributions += collection.totalPullRequestContributions;
    totalPullRequestReviewContributions +=
      collection.totalPullRequestReviewContributions;
    totalRepositoryContributions += collection.totalRepositoryContributions;

    for (const week of collection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) {
        daysByDate.set(day.date.slice(0, 10), day);
      }
    }
  }

  const contributionCalendar = [...daysByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, day]) => ({
      contributionCount: day.contributionCount,
      contributionLevel: levelMap[day.contributionLevel],
      date: day.date,
    }));

  const totalForkCount = base.data.user.repositories.nodes.reduce(
    (sum, node) => sum + node.forkCount,
    0,
  );
  const totalStargazerCount = base.data.user.repositories.nodes.reduce(
    (sum, node) => sum + node.stargazerCount,
    0,
  );

  return {
    isHalloween,
    contributionCalendar,
    contributesLanguage: mergeLanguages(collections),
    totalContributions,
    totalCommitContributions,
    totalIssueContributions,
    totalPullRequestContributions,
    totalPullRequestReviewContributions,
    totalRepositoryContributions,
    totalForkCount,
    totalStargazerCount,
  };
}

function postProcessSvg(svg, totalContributions) {
  let updated = svg.replace(
    /(<text[^>]*class="fill-strong"[^>]*>)[\d,]+(<\/text>)/,
    `$1${totalContributions}$2`,
  );

  updated = updated.replace(
    /<text[^>]*>\d{4}-\d{2}-\d{2} \/ \d{4}-\d{2}-\d{2}<\/text>/,
    '',
  );

  return updated;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const username = process.env.USERNAME;

  if (!token || !username) {
    throw new Error('GITHUB_TOKEN and USERNAME are required');
  }

  ensureTool();

  const userInfo = await fetchAllTimeUserInfo(username, token);
  fs.mkdirSync(path.dirname(userInfoPath), { recursive: true });
  fs.writeFileSync(userInfoPath, JSON.stringify(userInfo));

  execSync(
    `npx ts-node --transpile-only "${renderScriptPath}" "${outputPath}"`,
    {
      cwd: toolDir,
      env: {
        ...process.env,
        USER_INFO_PATH: userInfoPath,
      },
      stdio: 'inherit',
    },
  );

  const svg = postProcessSvg(
    fs.readFileSync(outputPath, 'utf8'),
    userInfo.totalContributions,
  );
  fs.writeFileSync(outputPath, svg);

  console.log(
    `Generated ${outputPath} with ${userInfo.totalContributions} total contributions across ${userInfo.contributionCalendar.length} days`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
