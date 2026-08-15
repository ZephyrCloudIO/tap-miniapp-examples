export const supportedRstestVersionsBySdk = new Map([
  ["0.0.0-fix-roadie-dev-origin.1", "0.11.5"],
  ["0.7.0", "0.11.5"],
  ["0.4.9", "0.11.5"],
]);

const exactSemverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export const isExactSdkVersion = (version) =>
  typeof version === "string" && exactSemverPattern.test(version);

export const expectedRstestVersionForSdk = (sdkVersion) =>
  supportedRstestVersionsBySdk.get(sdkVersion);
