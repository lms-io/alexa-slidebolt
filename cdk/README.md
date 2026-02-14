# SlideBolt CDK

## Prereqs

- AWS CLI v2 (`aws --version`)
- AWS CDK v2 (`cdk --version`)
- Node.js + npm

## Bootstrap

```bash
cd /home/gavin/work/gotest/git/alexa-slidebolt/cdk
cdk bootstrap aws://837101453330/us-east-1
```

## Deploy

```bash
cd /home/gavin/work/gotest/git/alexa-slidebolt/cdk
npm run build
cdk deploy SldBltProdStack
```

## Outputs

- WebSocket URL
- WebSocket Management URL
- DynamoDB Table Name

## Notes

- `WS_SHARED_SECRET` is passed as a CloudFormation parameter (no-echo).
- The WS API uses route selection `action` (e.g. `register`), with `$default` fallback.
