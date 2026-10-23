import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// Keep manifest.json in step with package.json. minAppVersion is left alone:
// it is a floor raised only when an unguarded Obsidian API requires it.
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

console.log(`manifest.json → ${targetVersion} (minAppVersion ${minAppVersion})`);
