import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("=".repeat(60));
  console.log("STABLE JACK DEPLOYMENT - SCROLL SEPOLIA");
  console.log("=".repeat(60));
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("=".repeat(60));

  /* --------------------------------------------------
     EXISTING MOCK DEPLOYMENTS (already deployed on Scroll Sepolia)
     
     These contracts simulate the stETH/wstETH ecosystem:
     - MockWSTETH: The base token (like wstETH on Ethereum)
     - MockRateProvider: Provides wstETH/stETH exchange rate (for yield simulation)
     - MockPriceOracle: Provides USD price of wstETH (for price exposure)
  -------------------------------------------------- */

  const MOCK_WSTETH = "0x73727e0f872e4B45771a9adE4F6F338d21d0870A";
  const RATE_PROVIDER = "0x06b1F2C0DdfF23a7AB1Cb36178259D8f279941Dd";
  const PRICE_ORACLE = "0xc710fd53df8dF241A728A5b835F455a630CBf5eA";

  console.log("\nUsing existing mock contracts:");
  console.log("  MockWSTETH:    ", MOCK_WSTETH);
  console.log("  RateProvider:  ", RATE_PROVIDER);
  console.log("  PriceOracle:   ", PRICE_ORACLE);

  /* --------------------------------------------------
     CONSTANTS
  -------------------------------------------------- */

  // Initial mint ratio: 50% for aToken, 50% for xToken
  // IMPORTANT: Must be < 1e18 (the constructor requires this)
  const INITIAL_MINT_RATIO = ethers.parseUnits("0.5", 18); // 50%
  
  const ZERO_ADDRESS = ethers.ZeroAddress;
  
  // Beta: volatility exposure for aToken (0 = fully stable)
  const BETA = 0n;
  
  // Base token cap (1 million wstETH with 18 decimals)
  const BASE_TOKEN_CAP = ethers.parseUnits("1000000", 18);
  
  // EMA sample interval for leverage ratio (1 hour = 3600 seconds)
  const EMA_SAMPLE_INTERVAL = 3600;

  /* --------------------------------------------------
     STEP 1: DEPLOY TREASURY (uninitialized)
     
     Treasury is the core contract that:
     - Holds all base tokens (wstETH)
     - Manages minting/burning of aToken and xToken
     - Tracks collateral ratio and leverage
  -------------------------------------------------- */

  console.log("\n[1/9] Deploying Treasury...");
  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(INITIAL_MINT_RATIO);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log("      Treasury deployed at:", treasuryAddress);

  /* --------------------------------------------------
     STEP 2: DEPLOY SYNTHETIC TOKEN (aToken)
     
     aToken is the stable/fractional token:
     - Pegged close to $1 USD
     - Gets yield from underlying staking rewards
     - Lower risk, lower return
  -------------------------------------------------- */

  console.log("\n[2/9] Deploying SyntheticToken (aToken)...");
  const SyntheticToken = await ethers.getContractFactory("SyntheticToken");
  const aToken = await SyntheticToken.deploy();
  await aToken.waitForDeployment();
  const aTokenAddress = await aToken.getAddress();
  console.log("      aToken deployed at:", aTokenAddress);

  // Initialize aToken with treasury reference
  const aTokenInitTx = await aToken.initialize(
    treasuryAddress,
    "Fractional wstETH",  // name
    "fwstETH"             // symbol
  );
  await aTokenInitTx.wait();
  console.log("      aToken initialized ✓");

  /* --------------------------------------------------
     STEP 3: DEPLOY LEVERAGED TOKEN (xToken)
     
     xToken is the leveraged token:
     - Absorbs price volatility of underlying
     - Higher risk, higher potential return
     - NAV increases when base token price goes up
  -------------------------------------------------- */

  console.log("\n[3/9] Deploying LeveragedToken (xToken)...");
  const LeveragedToken = await ethers.getContractFactory("LeveragedToken");
  const xToken = await LeveragedToken.deploy();
  await xToken.waitForDeployment();
  const xTokenAddress = await xToken.getAddress();
  console.log("      xToken deployed at:", xTokenAddress);

  // Initialize xToken with treasury and aToken references
  const xTokenInitTx = await xToken.initialize(
    treasuryAddress,
    aTokenAddress,
    "Leveraged wstETH",   // name
    "xwstETH"             // symbol
  );
  await xTokenInitTx.wait();
  console.log("      xToken initialized ✓");

  /* --------------------------------------------------
     STEP 4: DEPLOY MARKET
     
     Market is the user-facing contract for:
     - Minting aToken and xToken
     - Redeeming tokens back to base token
     - Fee management
  -------------------------------------------------- */

  console.log("\n[4/9] Deploying Market...");
  const Market = await ethers.getContractFactory("Market");
  const market = await Market.deploy();
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  console.log("      Market deployed at:", marketAddress);

  /* --------------------------------------------------
     STEP 5: INITIALIZE TREASURY
     
     Treasury.initialize() parameters:
     1. _market: Market contract address
     2. _baseToken: wstETH address (the collateral)
     3. _aToken: SyntheticToken address
     4. _xToken: LeveragedToken address
     5. _priceOracle: Price oracle for USD price
     6. _beta: Volatility exposure for aToken (0 = stable)
     7. _baseTokenCap: Maximum deposits allowed
     8. _rateProvider: For wstETH/stETH conversion
  -------------------------------------------------- */

  console.log("\n[5/9] Initializing Treasury...");
  const treasuryInitTx = await treasury.initialize(
    marketAddress,      // _market
    MOCK_WSTETH,        // _baseToken (wstETH)
    aTokenAddress,      // _aToken
    xTokenAddress,      // _xToken
    PRICE_ORACLE,       // _priceOracle
    BETA,               // _beta (0 for fully stable aToken)
    BASE_TOKEN_CAP,     // _baseTokenCap
    RATE_PROVIDER       // _rateProvider
  );
  await treasuryInitTx.wait();
  console.log("      Treasury initialized ✓");

  /* --------------------------------------------------
     STEP 6: INITIALIZE MARKET
     
     Market.initialize() parameters:
     1. _treasury: Treasury contract address
     2. _platform: Fee recipient address
     3. _gateway: Gateway for native token wrapping (not used on Scroll)
  -------------------------------------------------- */

  console.log("\n[6/9] Initializing Market...");
  const marketInitTx = await market.initialize(
    treasuryAddress,    // _treasury
    deployer.address,   // _platform (receives fees)
    ZERO_ADDRESS        // _gateway (unused on Scroll)
  );
  await marketInitTx.wait();
  console.log("      Market initialized ✓");

  /* --------------------------------------------------
     STEP 7: DEPLOY REBALANCE POOL
     
     RebalancePool is the stability pool for:
     - Liquidating under-collateralized positions
     - Distributing rewards to depositors
  -------------------------------------------------- */

  console.log("\n[7/9] Deploying RebalancePool...");
  const RebalancePool = await ethers.getContractFactory("RebalancePool");
  const rebalancePool = await RebalancePool.deploy();
  await rebalancePool.waitForDeployment();
  const rebalancePoolAddress = await rebalancePool.getAddress();
  console.log("      RebalancePool deployed at:", rebalancePoolAddress);

  // Initialize RebalancePool
  const rebalancePoolInitTx = await rebalancePool.initialize(
    treasuryAddress,
    marketAddress
  );
  await rebalancePoolInitTx.wait();
  console.log("      RebalancePool initialized ✓");

  /* --------------------------------------------------
     STEP 8: INITIALIZE TREASURY V2 (EMA Leverage Ratio)
     
     This enables the exponential moving average tracking
     for leverage ratio calculations.
  -------------------------------------------------- */

  console.log("\n[8/9] Initializing Treasury V2 (EMA)...");
  const v2InitTx = await treasury.initializeV2(EMA_SAMPLE_INTERVAL);
  await v2InitTx.wait();
  console.log("      Treasury V2 initialized with EMA interval:", EMA_SAMPLE_INTERVAL, "seconds ✓");

  /* --------------------------------------------------
     STEP 9: INITIALIZE PRICE
     
     Sets the initial reference price for the protocol.
     This must be called after the price oracle is working.
  -------------------------------------------------- */

  console.log("\n[9/9] Initializing Price...");
  const priceInitTx = await treasury.initializePrice();
  await priceInitTx.wait();
  console.log("      Price initialized ✓");

  /* --------------------------------------------------
     DEPLOYMENT SUMMARY
  -------------------------------------------------- */

  console.log("\n" + "=".repeat(60));
  console.log("STABLE JACK DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  
  console.log("\n📜 DEPLOYED CONTRACTS:");
  console.log("-".repeat(60));
  console.log(`Treasury:        ${treasuryAddress}`);
  console.log(`SyntheticToken:  ${aTokenAddress} (fwstETH)`);
  console.log(`LeveragedToken:  ${xTokenAddress} (xwstETH)`);
  console.log(`Market:          ${marketAddress}`);
  console.log(`RebalancePool:   ${rebalancePoolAddress}`);
  
  console.log("\n🔗 EXTERNAL DEPENDENCIES:");
  console.log("-".repeat(60));
  console.log(`BaseToken:       ${MOCK_WSTETH} (MockWSTETH)`);
  console.log(`RateProvider:    ${RATE_PROVIDER}`);
  console.log(`PriceOracle:     ${PRICE_ORACLE}`);
  
  console.log("\n⚙️  CONFIGURATION:");
  console.log("-".repeat(60));
  console.log(`Initial Mint Ratio: 50% aToken / 50% xToken`);
  console.log(`Beta (aToken volatility): 0 (fully stable)`);
  console.log(`Base Token Cap: 1,000,000 wstETH`);
  console.log(`EMA Sample Interval: ${EMA_SAMPLE_INTERVAL} seconds`);
  
  console.log("\n" + "=".repeat(60));
  console.log("🎉 Ready to use! Next steps:");
  console.log("   1. Approve wstETH spending on Market contract");
  console.log("   2. Call market.mint() to initialize the pool");
  console.log("   3. Use mintaToken/mintXToken via gateway");
  console.log("=".repeat(60));

  // Return addresses for verification
  return {
    treasury: treasuryAddress,
    aToken: aTokenAddress,
    xToken: xTokenAddress,
    market: marketAddress,
    rebalancePool: rebalancePoolAddress,
  };
}

main()
  .then((addresses) => {
    console.log("\n✅ Deployment successful!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });