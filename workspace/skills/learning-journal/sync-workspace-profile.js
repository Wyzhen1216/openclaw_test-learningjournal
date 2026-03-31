const fs = require('fs-extra');
const path = require('path');

const skillRoot = __dirname;
const workspaceRoot = path.resolve(skillRoot, '..', '..');
const profileDir = path.join(skillRoot, 'workspace-profile');
const targetFiles = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'TOOLS.md'];

async function syncProfile() {
  const exists = await fs.pathExists(profileDir);
  if (!exists) {
    console.error(`Profile directory not found: ${profileDir}`);
    process.exit(1);
  }

  const copied = [];
  const skipped = [];

  for (const file of targetFiles) {
    const source = path.join(profileDir, file);
    const target = path.join(workspaceRoot, file);
    const hasFile = await fs.pathExists(source);

    if (!hasFile) {
      skipped.push(file);
      continue;
    }

    await fs.copy(source, target, { overwrite: true });
    copied.push(file);
  }

  if (copied.length > 0) {
    console.log('Synced files:');
    for (const file of copied) {
      console.log(`- ${file}`);
    }
  } else {
    console.log('No profile files were synced.');
  }

  if (skipped.length > 0) {
    console.log('Skipped (not found in profile):');
    for (const file of skipped) {
      console.log(`- ${file}`);
    }
  }
}

syncProfile().catch((error) => {
  console.error(`Sync failed: ${error.message}`);
  process.exit(1);
});
