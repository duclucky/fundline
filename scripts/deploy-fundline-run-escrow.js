const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ContractFactory, JsonRpcProvider, Wallet, getAddress } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const CONTRACT_PATH = path.join(ROOT, "contracts", "FundlineRunEscrow.sol");
const ABI_PATH = path.join(ROOT, "contracts", "FundlineRunEscrow.abi.json");
const DEFAULT_USDC = "0x3600000000000000000000000000000000000000";

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  loadEnv(ENV_PATH);

  const rpcUrl = requiredEnv("ARC_RPC_URL");
  const privateKey = normalizePrivateKey(requiredEnv("ARC_DEPLOYER_PRIVATE_KEY"));
  const usdc = getAddress(String(process.env.ARC_USDC_TOKEN_ADDRESS || DEFAULT_USDC).trim());
  const treasury = getAddress(requiredEnv("ARC_TREASURY_ADDRESS"));

  const { abi, bytecode } = compileRunEscrow();
  fs.writeFileSync(ABI_PATH, `${JSON.stringify(abi, null, 2)}\n`);

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const network = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);

  if (balance === 0n) {
    throw new Error(`Deployer ${wallet.address} has 0 native gas balance on chain ${network.chainId}.`);
  }

  console.log(`Deploying FundlineRunEscrow on chain ${network.chainId}`);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`USDC: ${usdc}`);
  console.log(`Treasury: ${treasury}`);

  const factory = new ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(usdc, treasury);
  const deploymentTx = contract.deploymentTransaction();
  console.log(`Deploy tx: ${deploymentTx.hash}`);

  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const receipt = await provider.getTransactionReceipt(deploymentTx.hash);

  updateEnvValue(ENV_PATH, "ARC_RUN_ESCROW_ADDRESS", address);

  console.log(`FundlineRunEscrow deployed: ${address}`);
  console.log(`Block: ${receipt?.blockNumber || "-"}`);
  console.log(`Wrote ABI: ${ABI_PATH}`);
  console.log("Updated .env: ARC_RUN_ESCROW_ADDRESS");
}

function compileRunEscrow() {
  const source = fs.readFileSync(CONTRACT_PATH, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "FundlineRunEscrow.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = Array.isArray(output.errors) ? output.errors : [];
  const fatal = errors.filter((item) => item.severity === "error");
  errors
    .filter((item) => item.severity !== "error")
    .forEach((item) => console.warn(item.formattedMessage || item.message));
  if (fatal.length) {
    throw new Error(fatal.map((item) => item.formattedMessage || item.message).join("\n"));
  }

  const contract = output.contracts?.["FundlineRunEscrow.sol"]?.FundlineRunEscrow;
  if (!contract?.abi || !contract?.evm?.bytecode?.object) {
    throw new Error("FundlineRunEscrow compile output is missing ABI or bytecode.");
  }

  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) return;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
}

function requiredEnv(key) {
  const value = String(process.env[key] || "").trim();
  if (!value) throw new Error(`Missing ${key} in ${ENV_PATH}`);
  return value;
}

function normalizePrivateKey(value) {
  const text = String(value || "").trim();
  const normalized = text.startsWith("0x") ? text : `0x${text}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error("ARC_DEPLOYER_PRIVATE_KEY must be a 32-byte hex private key.");
  }
  return normalized;
}

function updateEnvValue(filePath, key, value) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const line = `${key}=${value}`;
  const next = new RegExp(`^${escapeRegExp(key)}=.*$`, "m").test(existing)
    ? existing.replace(new RegExp(`^${escapeRegExp(key)}=.*$`, "m"), line)
    : `${existing.replace(/\s*$/, "")}\n${line}\n`;
  fs.writeFileSync(filePath, next.endsWith("\n") ? next : `${next}\n`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
