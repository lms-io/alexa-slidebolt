import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as appregistry from 'aws-cdk-lib/aws-servicecatalogappregistry';

export class SldBltStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stage = 'prod';
    const prefix = 'SldBlt';

    // AppRegistry Application (L1)
    const application = new appregistry.CfnApplication(this, 'AppRegistryApplication', {
      name: `${prefix}-${stage}`,
      description: 'SlideBolt Smart Home Infrastructure',
    });

    new appregistry.CfnResourceAssociation(this, 'AppRegistryAssociation', {
      application: application.attrId,
      resource: this.stackId,
      resourceType: 'CFN_STACK',
    });

    const wsSharedSecret = new cdk.CfnParameter(this, 'WsSharedSecret', {
      type: 'String',
      noEcho: true,
      description: 'Shared secret for SlideBolt Admin actions.',
    });

    const alexaSkillId = new cdk.CfnParameter(this, 'AlexaSkillId', {
      type: 'String',
      description: 'Alexa Smart Home Skill ID for Lambda invoke permission.',
    });

    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: `${prefix}Users-v2-${stage}`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    usersTable.addGlobalSecondaryIndex({
      indexName: 'OwnerEmailIndex',
      partitionKey: { name: 'ownerEmail', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const devicesTable = new dynamodb.Table(this, 'DevicesTable', {
      tableName: `${prefix}Devices-v2-${stage}`,
      partitionKey: { name: 'clientId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const lambdaCodeDir = path.join(__dirname, '..', '..', 'lambda');

    // --- Lambdas ---

    const wsRelay = new lambda.Function(this, 'WsRelayLambda', {
      functionName: `${prefix}Relay`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'slideBoltWsRelay.handler',
      code: lambda.Code.fromAsset(lambdaCodeDir),
      timeout: cdk.Duration.seconds(10),
      environment: {
        USERS_TABLE: usersTable.tableName,
        DEVICES_TABLE: devicesTable.tableName,
      },
    });

    const smartHome = new lambda.Function(this, 'SmartHomeLambda', {
      functionName: `${prefix}SmartHome`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'slideBoltSmartHome.handler',
      code: lambda.Code.fromAsset(lambdaCodeDir),
      timeout: cdk.Duration.seconds(10),
      environment: {
        USERS_TABLE: usersTable.tableName,
        DEVICES_TABLE: devicesTable.tableName,
        TEST_ALEXA_TOKEN: process.env.TEST_ALEXA_TOKEN || '',
      },
    });

    const adminLambda = new lambda.Function(this, 'AdminLambda', {
      functionName: `${prefix}Admin`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'slideBoltAdmin.handler',
      code: lambda.Code.fromAsset(lambdaCodeDir),
      timeout: cdk.Duration.seconds(10),
      environment: {
        USERS_TABLE: usersTable.tableName,
        DEVICES_TABLE: devicesTable.tableName,
        ADMIN_SECRET: wsSharedSecret.valueAsString,
      },
    });

    // --- Permissions ---

    usersTable.grantReadWriteData(wsRelay);
    devicesTable.grantReadWriteData(wsRelay);
    
    usersTable.grantReadWriteData(smartHome);
    devicesTable.grantReadWriteData(smartHome);
    
    usersTable.grantReadWriteData(adminLambda);
    devicesTable.grantReadWriteData(adminLambda);

    // --- WebSocket API ---

    const wsApi = new apigwv2.WebSocketApi(this, 'WsApi', {
      apiName: `${prefix}WsApi-${stage}`,
      routeSelectionExpression: '$request.body.action',
    });

    const wsStage = new apigwv2.WebSocketStage(this, 'WsStage', {
      webSocketApi: wsApi,
      stageName: stage,
      autoDeploy: true,
    });

    // --- Integrations ---

    const relayIntegration = new apigwv2Integrations.WebSocketLambdaIntegration(
      'WsRelayIntegration',
      wsRelay
    );

    const adminIntegration = new apigwv2Integrations.WebSocketLambdaIntegration(
      'AdminIntegration',
      adminLambda
    );

    // --- Routes ---

    // Relay Routes
    wsApi.addRoute('$connect', { integration: relayIntegration });
    wsApi.addRoute('$disconnect', { integration: relayIntegration });
    wsApi.addRoute('$default', { integration: relayIntegration });
    wsApi.addRoute('register', { integration: relayIntegration });
    wsApi.addRoute('state_update', { integration: relayIntegration });
    wsApi.addRoute('device_upsert', { integration: relayIntegration });
    wsApi.addRoute('list_devices', { integration: relayIntegration });
    wsApi.addRoute('delete_device', { integration: relayIntegration });

    // Admin Routes
    wsApi.addRoute('admin_create_client', { integration: adminIntegration });
    wsApi.addRoute('admin_list_clients', { integration: adminIntegration });
    wsApi.addRoute('admin_revoke_client', { integration: adminIntegration });
    wsApi.addRoute('admin_update_client', { integration: adminIntegration });
    wsApi.addRoute('admin_delete_client', { integration: adminIntegration });
    wsApi.addRoute('admin_add_user_to_client', { integration: adminIntegration });
    wsApi.addRoute('admin_remove_user_from_client', { integration: adminIntegration });
    wsApi.addRoute('admin_list_client_users', { integration: adminIntegration });

    // --- Lambda Invocation Permissions (API Gateway) ---

    // Helper to grant invoke permissions for multiple routes
    const grantInvoke = (fn: lambda.Function, routes: string[], idPrefix: string) => {
      routes.forEach(route => {
        // Clean route name for ID (replace $ with empty, _ with CamelCase or similar)
        // Simple sanitization for Construct ID
        const cleanRoute = route.replace(/\$/g, '').replace(/_([a-z])/g, (g) => g[1].toUpperCase()).replace(/^_/, '') || 'Default';
        // Capitalize first letter
        const idSuffix = cleanRoute.charAt(0).toUpperCase() + cleanRoute.slice(1);
        
        new lambda.CfnPermission(this, `${idPrefix}InvokePermission${idSuffix}`, {
          action: 'lambda:InvokeFunction',
          functionName: fn.functionArn,
          principal: 'apigateway.amazonaws.com',
          sourceArn: cdk.Stack.of(this).formatArn({
            service: 'execute-api',
            resource: wsApi.apiId,
            resourceName: `${stage}/${route}`,
          }),
        });
      });
    };

    grantInvoke(wsRelay, ['$connect', '$disconnect', '$default', 'register', 'state_update', 'device_upsert', 'list_devices', 'delete_device'], 'WsRelay');
    grantInvoke(adminLambda, [
      'admin_create_client', 
      'admin_list_clients', 
      'admin_revoke_client', 
      'admin_update_client', 
      'admin_delete_client',
      'admin_add_user_to_client',
      'admin_remove_user_from_client',
      'admin_list_client_users'
    ], 'Admin');


    // Smart Home Permissions
    wsApi.grantManageConnections(smartHome);
    wsApi.grantManageConnections(wsRelay);
    wsApi.grantManageConnections(adminLambda);

    const wsMgmtEndpoint = `https://${wsApi.apiId}.execute-api.${cdk.Stack.of(this).region}.${cdk.Stack.of(this).urlSuffix}/${wsStage.stageName}`;
    smartHome.addEnvironment('WS_MGMT_ENDPOINT', wsMgmtEndpoint);
    wsRelay.addEnvironment('WS_MGMT_ENDPOINT', wsMgmtEndpoint);
    adminLambda.addEnvironment('WS_MGMT_ENDPOINT', wsMgmtEndpoint);

    smartHome.addPermission('AlexaSmartHomeInvoke', {
      principal: new iam.ServicePrincipal('alexa-connectedhome.amazon.com'),
      action: 'lambda:InvokeFunction',
      eventSourceToken: alexaSkillId.valueAsString,
    });

    // --- Outputs ---

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: wsApi.apiEndpoint,
    });

    new cdk.CfnOutput(this, 'WebSocketMgmtUrl', {
      value: wsMgmtEndpoint,
    });

    new cdk.CfnOutput(this, 'UsersTableName', {
      value: usersTable.tableName,
    });

    new cdk.CfnOutput(this, 'DevicesTableName', {
      value: devicesTable.tableName,
    });
  }
}