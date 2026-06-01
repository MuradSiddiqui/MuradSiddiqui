import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as type from '../.cache/github-profile-3d-contrib/src/type';

const userInfoPath = process.env.USER_INFO_PATH;
const outputPath = process.argv[2];
const toolDir = path.resolve(__dirname, '../.cache/github-profile-3d-contrib');

if (!userInfoPath || !outputPath) {
  console.error('USER_INFO_PATH and output path are required');
  process.exit(1);
}

async function main() {
  const create = await import(
    pathToFileURL(path.join(toolDir, 'src/create-svg.ts')).href
  );
  const template = await import(
    pathToFileURL(path.join(toolDir, 'src/color-template.ts')).href
  );

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

  svg = svg.replace(
    /<text[^>]*>\s*\d{4}-\d{2}-\d{2}\s*\/\s*\d{4}-\d{2}-\d{2}\s*<\/text>/,
    '',
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, svg);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
