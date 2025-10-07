import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const cloudflareAccountId = config.require("cloudflare-accountId");

const zone = new cloudflare.Zone("gryphoon", {
  account: { id: cloudflareAccountId },
  name: "gryphoon.work",
  type: "full"
}, { protect: true });

const admin = new cloudflare.PagesProject(
  "gryphoon-admin",
  {
    accountId: cloudflareAccountId,
    name: "gryphoon-admin",
    productionBranch: "trunk",
    source: {
      config: {
        owner: "hckr-studio",
        previewBranchIncludes: ["*"],
        productionBranch: "trunk",
        repoName: "gryphoon",
      },
      type: "github",
    },
    buildConfig: {
      buildCommand: "yarn build",
      destinationDir: "../.blendid/gryphoon.work",
      rootDir: "gryphoon.work",
    },
    deploymentConfigs: {
      preview: {},
      production: {
        compatibilityDate: "2025-10-01",
        envVars: {},
      },
    },
  },
  { dependsOn: [] },
);
const adminRecord = new cloudflare.DnsRecord(
  "gryphoon-admin-record",
  {
    name: "@",
    proxied: true,
    ttl: 1,
    type: "CNAME",
    content: admin.domains[0],
    zoneId: zone.id,
  },
  { dependsOn: [admin, zone] },
);
const adminDomain = new cloudflare.PagesDomain(
  "gryphoon-admin-domain",
  {
    accountId: cloudflareAccountId,
    name: pulumi.interpolate`${zone.name}`,
    projectName: admin.name,
  },
  { dependsOn: [admin, adminRecord, zone] },
);

const web = new cloudflare.PagesProject(
  "gryphoon-web",
  {
    accountId: cloudflareAccountId,
    name: "gryphoon-web",
    productionBranch: "trunk",
    source: {
      config: {
        owner: "hckr-studio",
        previewBranchIncludes: ["*"],
        productionBranch: "trunk",
        repoName: "gryphoon",
      },
      type: "github",
    },
    buildConfig: {
      buildCommand: "yarn build",
      destinationDir: "../.blendid/www.gryphoon.work",
      rootDir: "www.gryphoon.work",
    },
    deploymentConfigs: {
      preview: {},
      production: {
        compatibilityDate: "2025-10-01",
        envVars: {},
      },
    },
  },
  { dependsOn: [] },
);
const webRecord = new cloudflare.DnsRecord(
  "gryphoon-web-record",
  {
    name: "www",
    proxied: true,
    ttl: 1,
    type: "CNAME",
    content: web.domains[0],
    zoneId: zone.id,
  },
  { dependsOn: [web, zone] },
);
const webDomain = new cloudflare.PagesDomain(
  "gryphoon-web-domain",
  {
    accountId: cloudflareAccountId,
    name: pulumi.interpolate`${webRecord.name}.${zone.name}`,
    projectName: web.name,
  },
  { dependsOn: [web, webRecord, zone] },
);
