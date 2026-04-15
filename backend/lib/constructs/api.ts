import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { UserPool } from 'aws-cdk-lib/aws-cognito';

export interface ApiConstructProps {
  stageName: string;
  table: Table;
  userPool: UserPool;
}

export class ApiConstruct extends Construct {
  public readonly restApi: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const { stageName, table, userPool } = props;

    // --- Lambda functions ---

    const commonEnv = {
      TABLE_NAME: table.tableName,
      STAGE: stageName,
      NODE_OPTIONS: '--enable-source-maps',
    };

    const bundlingOptions: NodejsFunction['node']['defaultChild'] extends object
      ? object
      : object = {
      minify: stageName === 'prod',
      sourceMap: true,
      externalModules: [],
    };

    const applicationsHandler = new NodejsFunction(this, 'ApplicationsHandler', {
      functionName: `JobAppManager-Applications-${stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/applications/handler.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: commonEnv,
      bundling: {
        minify: stageName === 'prod',
        sourceMap: true,
        externalModules: [],
      },
    });

    const statusHandler = new NodejsFunction(this, 'StatusHandler', {
      functionName: `JobAppManager-Status-${stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/status/handler.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: commonEnv,
      bundling: {
        minify: stageName === 'prod',
        sourceMap: true,
        externalModules: [],
      },
    });

    const dashboardHandler = new NodejsFunction(this, 'DashboardHandler', {
      functionName: `JobAppManager-Dashboard-${stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/dashboard/handler.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      environment: commonEnv,
      bundling: {
        minify: stageName === 'prod',
        sourceMap: true,
        externalModules: [],
      },
    });

    // Grant DynamoDB access
    table.grantReadWriteData(applicationsHandler);
    table.grantReadWriteData(statusHandler);
    table.grantReadData(dashboardHandler);

    // --- API Gateway ---

    this.restApi = new apigateway.RestApi(this, 'RestApi', {
      restApiName: `JobAppManager-${stageName}`,
      description: 'Job Application Manager REST API',
      deployOptions: {
        stageName,
        throttlingRateLimit: 1000,
        throttlingBurstLimit: 2000,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Cognito authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
      authorizerName: `JobAppManager-Authorizer-${stageName}`,
    });

    const authOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // --- Routes ---

    const v1 = this.restApi.root.addResource('v1');

    // /v1/applications
    const applications = v1.addResource('applications');
    applications.addMethod(
      'GET',
      new apigateway.LambdaIntegration(applicationsHandler),
      authOptions,
    );
    applications.addMethod(
      'POST',
      new apigateway.LambdaIntegration(applicationsHandler),
      authOptions,
    );

    // /v1/applications/{id}
    const applicationById = applications.addResource('{id}');
    applicationById.addMethod(
      'GET',
      new apigateway.LambdaIntegration(applicationsHandler),
      authOptions,
    );
    applicationById.addMethod(
      'PATCH',
      new apigateway.LambdaIntegration(applicationsHandler),
      authOptions,
    );
    applicationById.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(applicationsHandler),
      authOptions,
    );

    // /v1/applications/{id}/status
    const applicationStatus = applicationById.addResource('status');
    applicationStatus.addMethod(
      'POST',
      new apigateway.LambdaIntegration(statusHandler),
      authOptions,
    );

    // /v1/dashboard
    const dashboard = v1.addResource('dashboard');
    dashboard.addMethod(
      'GET',
      new apigateway.LambdaIntegration(dashboardHandler),
      authOptions,
    );
  }
}
