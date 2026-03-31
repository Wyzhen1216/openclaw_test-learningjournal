#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = __dirname;
const PROFILE_FILES = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'TOOLS.md'];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getSkillDirs() {
  const entries = await fs.readdir(SKILLS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

async function resolveProfileSourceDir(skillName) {
  const skillDir = path.join(SKILLS_ROOT, skillName);
  const profileDir = path.join(skillDir, 'workspace-profile');

  if (await pathExists(profileDir)) {
    return profileDir;
  }
  return skillDir;
}

async function getProfileStatus(skillName) {
  const sourceDir = await resolveProfileSourceDir(skillName);
  const checks = await Promise.all(
    PROFILE_FILES.map(async (file) => {
      const fullPath = path.join(sourceDir, file);
      const exists = await pathExists(fullPath);
      return { file, exists };
    })
  );
  const complete = checks.every((item) => item.exists);
  return { skillName, sourceDir, checks, complete };
}

async function listProfiles() {
  const skills = await getSkillDirs();
  const statuses = await Promise.all(skills.map((skill) => getProfileStatus(skill)));

  console.log('Available skill profiles:');
  for (const status of statuses) {
    const mode = status.sourceDir.endsWith('workspace-profile') ? 'workspace-profile' : 'skill-root';
    const state = status.complete ? 'ready' : 'incomplete';
    const missing = status.checks.filter((item) => !item.exists).map((item) => item.file);
    console.log(`- ${status.skillName} [${mode}] (${state})`);
    if (missing.length > 0) {
      console.log(`  missing: ${missing.join(', ')}`);
    }
  }
}

async function useProfile(skillName) {
  const skillDir = path.join(SKILLS_ROOT, skillName);
  if (!(await pathExists(skillDir))) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  const status = await getProfileStatus(skillName);
  if (!status.complete) {
    const missing = status.checks.filter((item) => !item.exists).map((item) => item.file);
    throw new Error(
      `Profile is incomplete for "${skillName}". Missing: ${missing.join(', ')}`
    );
  }

  for (const file of PROFILE_FILES) {
    const source = path.join(status.sourceDir, file);
    const target = path.join(WORKSPACE_ROOT, file);
    await fs.copyFile(source, target);
  }

  console.log(`Profile switched to: ${skillName}`);
  console.log(`Source: ${status.sourceDir}`);
  console.log(`Synced: ${PROFILE_FILES.join(', ')}`);
}

function printHelp() {
  console.log('Usage:');
  console.log('  node skills/profile-switcher.js list');
  console.log('  node skills/profile-switcher.js use <skill-name>');
}

async function main() {
  const [, , command, arg] = process.argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'list') {
    await listProfiles();
    return;
  }

  if (command === 'use') {
    if (!arg) {
      throw new Error('Please provide a skill name, e.g. "learning-journal".');
    }
    await useProfile(arg);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
