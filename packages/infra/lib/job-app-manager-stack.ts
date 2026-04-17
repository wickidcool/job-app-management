import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DatabaseConstruct } from './constructs/database';
import { AuthConstruct } from './constructs/auth';
import { ApiConstruct } from './constructs/api';

export interface JobAppManagerStackProps extends cdk.StackProps {
  stageName: string;
}

export class JobAppManagerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: JobAppManagerStackProps) {
    super(scope, id, props);

    const { stageName } = props;

    // Database layer
    const database = new DatabaseConstruct(this, 'Database', { stageName });

    // Auth layer (Cognito)
    const auth = new AuthConstruct(this, 'Auth', { stageName });

    // API layer (API Gateway + Lambdas)
    const api = new ApiConstruct(this, 'Api', {
      stageName,
      table: database.table,
      userPool: auth.userPool,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.restApi.url,
      description: 'REST API base URL',
      exportName: `${id}-ApiUrl`,
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: auth.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${id}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: auth.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${id}-UserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: database.table.tableName,
      description: 'DynamoDB table name',
      exportName: `${id}-TableName`,
    });
  }
}
