# Local Requirements

The following tools must be installed locally before working with SlideBolt infrastructure, skills, and bundles.

## Core Tooling

- AWS CLI v2 (`aws`)
- AWS CDK v2 (`cdk`)
- Node.js 20+ (`node`, `npm`)
- Python 3.9+ (`python3`)
- ASK CLI v2 (`ask`)

## Install

### AWS CLI v2 (Linux)
```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
cd /tmp
unzip -q awscliv2.zip
sudo ./aws/install
aws --version
```

### AWS CDK v2
```bash
sudo npm i -g aws-cdk
cdk --version
```

### ASK CLI v2
```bash
npm i -g ask-cli
ask --version
ask configure
```

## Verify

```bash
aws --version
cdk --version
node --version
npm --version
python3 --version
ask --version
```
