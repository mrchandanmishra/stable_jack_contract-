import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying Stable Jack on Scroll Sepolia");
  console.log("Deployer:", deployer.address);

  /* --------------------------------------------------
     EXISTING MOCK DEPLOYMENTS
  -------------------------------------------------- */

  const MOCK_WSTETH = "0x73727e0f872e4B45771a9adE4F6F338d21d0870A";
  const RATE_PROVIDER = "0x06b1F2C0DdfF23a7AB1Cb36178259D8f279941Dd";
  const PRICE_ORACLE = "0xc710fd53df8dF241A728A5b835F455a630CBf5eA";

  /* --------------------------------------------------
     CONSTANTS (ethers v6)
  -------------------------------------------------- */

  const INITIAL_MINT_RATIO = ethers.parseUnits("1", 18);
  const ZERO_ADDRESS = ethers.ZeroAddress;

  /* --------------------------------------------------
     1. DEPLOY TREASURY
  -------------------------------------------------- */

  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(INITIAL_MINT_RATIO);
  await treasury.waitForDeployment();

  await treasury.initialize(
    MOCK_WSTETH,
    RATE_PROVIDER,
    PRICE_ORACLE
  );

  console.log("Treasury:", treasury.target);

  /* --------------------------------------------------
     2. DEPLOY MARKET
  -------------------------------------------------- */

  const Market = await ethers.getContractFactory("Market");
  const market = await Market.deploy();
  await market.waitForDeployment();

  await market.initialize(
    treasury.target,
    deployer.address, // platform
    ZERO_ADDRESS      // gateway (AVAX-only, unused on Scroll)
  );

  console.log("Market:", market.target);

  /* --------------------------------------------------
     3. DEPLOY REBALANCE POOL
  -------------------------------------------------- */

  const RebalancePool = await ethers.getContractFactory("RebalancePool");
  const rebalancePool = await RebalancePool.deploy();
  await rebalancePool.waitForDeployment();

  await rebalancePool.initialize(
    treasury.target,
    market.target
  );

  console.log("RebalancePool:", rebalancePool.target);

  /* --------------------------------------------------
     4. LINK CONTRACTS
  -------------------------------------------------- */

  await treasury.setMarket(market.target);

  console.log("Treasury ↔ Market linked");

  console.log("=================================");
  console.log("Stable Jack deployed successfully");
  console.log("=================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
