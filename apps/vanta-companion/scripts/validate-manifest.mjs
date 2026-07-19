import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(
  fs.readFileSync(
    new URL(
      '../node_modules/@theaiplatform/miniapp-sdk/config-schema.json',
      import.meta.url,
    ),
  ),
);
const manifest = JSON.parse(
  fs.readFileSync(new URL('../manifest.tap.json', import.meta.url)),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat('uint16', {
  type: 'number',
  validate: value => Number.isInteger(value) && value >= 0 && value <= 65_535,
});
ajv.addFormat('uint64', {
  type: 'number',
  validate: value => Number.isSafeInteger(value) && value >= 0,
});
ajv.addFormat('uri', {
  type: 'string',
  validate: value => {
    try {
      return Boolean(new URL(value));
    } catch {
      return false;
    }
  },
});
if (!ajv.validate(schema, manifest)) {
  console.error(ajv.errors);
  process.exit(1);
}
console.log('manifest.tap.json is valid');
