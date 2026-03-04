const { execSync } = require('child_process');
require('dotenv').config({ path: '.env.development.local' });

const keys = Object.keys(process.env).filter(k => k.startsWith('MD__'));

keys.forEach(key => {
    const standardKey = key.replace('MD__', '');
    const value = process.env[key];
    console.log(`Mapping ${key} to ${standardKey}...`);
    try {
        execSync(`npx vercel env rm ${standardKey} production -y`);
    } catch (e) {}
    try {
        execSync(`printf "%s" "${value}" | npx vercel env add ${standardKey} production`);
        console.log(`Successfully mapped ${standardKey}`);
    } catch(e) {
        console.error(`Failed to map ${standardKey}`, e.stdout?.toString(), e.stderr?.toString(), e.message);
    }
});
