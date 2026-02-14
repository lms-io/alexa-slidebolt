import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export const USERS_TABLE = process.env.USERS_TABLE;
export const DEVICES_TABLE = process.env.DEVICES_TABLE;

export const db = (tableName) => ({
  put: (item) => docClient.send(new PutCommand({ TableName: tableName, Item: item })),
  
  get: (key) => docClient.send(new GetCommand({ TableName: tableName, Key: key })),
  
  update: (key, updateExp, names, values, conditionExp) => {
    const params = {
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExp,
      ExpressionAttributeValues: values
    };
    if (names && Object.keys(names).length > 0) {
      params.ExpressionAttributeNames = names;
    }
    if (conditionExp) {
      params.ConditionExpression = conditionExp;
    }
    return docClient.send(new UpdateCommand(params));
  },

  delete: (key) => docClient.send(new DeleteCommand({ TableName: tableName, Key: key })),

  scan: (filterExp, values) => {
    const params = { TableName: tableName };
    if (filterExp) {
      params.FilterExpression = filterExp;
      params.ExpressionAttributeValues = values;
    }
    return docClient.send(new ScanCommand(params));
  },

  query: (keyCondition, values, indexName) => {
    const params = {
      TableName: tableName,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: values
    };
    if (indexName) params.IndexName = indexName;
    return docClient.send(new QueryCommand(params));
  }
});