#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { JobAppManagerStack } from '../lib/job-app-manager-stack';

const app = new cdk.App();

const env = app.node.tryGetContext('env') ?? 'dev';

new JobAppManagerStack(app, `JobAppManager-${env}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  stageName: env,
  tags: {
    Project: 'JobApplicationManager',
    Environment: env,
  },
});
