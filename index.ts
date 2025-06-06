import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import DLMM, { LbPosition } from '@meteora-ag/dlmm'
import { BN } from "@coral-xyz/anchor";
import { getMint, Mint, AccountLayout } from "@solana/spl-token";
import * as readline from 'readline';
import { executeRoute, getRoutes, createConfig, KeypairWalletAdapter, Solana} from '@lifi/sdk';

require('dotenv').config();


async function initializeClient(): Promise<{ connection: Connection; dlmm: DLMM }> {
  const RPC = "https://neat-magical-market.solana-mainnet.quiknode.pro/22f4786138ebd920140d051f0ebdc6da71f058db/";
  const poolAddress = new PublicKey(process.env.POOL_ADDRESS as string);
  const connection = new Connection(RPC, "finalized");
  const dlmm = await DLMM.create(connection, poolAddress, {
    cluster: "mainnet-beta",
  });
  return { connection, dlmm };
}

function getUserKeypair(): Keypair {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not found in environment variables");
  }
  const privateKeyArray = JSON.parse(PRIVATE_KEY);
  const privateKeyBytes = new Uint8Array(privateKeyArray);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  
  // Convert the private key bytes to base58 string
  const base58PrivateKey = bs58.encode(privateKeyBytes);
  
  const walletAdapter = new KeypairWalletAdapter(base58PrivateKey);
  
  createConfig({
    integrator: 'Amubophis',
    providers: [
      Solana({
        getWalletAdapter: async () => walletAdapter,
      }),
    ],
  });

  return keypair;
}

async function initializePosition(
  dlmm: DLMM,
  user: Keypair,
  newOneSidePosition: Keypair,
  connection: Connection,
  xAmount?: BN,
  yAmount?: BN
): Promise<void> {
  const totalIntervalRange = 10;
  const activeBin = await dlmm.getActiveBin();
  const maxBinId = activeBin.binId + totalIntervalRange;
  const minBinId = activeBin.binId - totalIntervalRange;

  // Use provided amounts or default to 0
  const totalXAmount = xAmount || new BN(0);
  const totalYAmount = yAmount || new BN(100 * 10 ** 6);

  // Add slippage tolerance (0.5%)
  const slippage = 50; // 0.5% in basis points

  // Create Position with slippage tolerance
  const createPositionTx =
    await dlmm.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newOneSidePosition.publicKey,
      user: user.publicKey,
      totalXAmount,
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: 0,
      },
      slippage, // Add slippage tolerance
    });

  try {
    const createOneSidePositionTxHash = await sendAndConfirmTransaction(
      connection,
      createPositionTx,
      [user, newOneSidePosition]
    );
    console.log(
      "🚀 ~ createOneSidePositionTxHash:",
      createOneSidePositionTxHash
    );
  } catch (error) {
    console.log("🚀 ~ createOneSidePosition::error:", JSON.parse(JSON.stringify(error)));
  }
}

async function addLiquidity(
  dlmm: DLMM,
  user: Keypair,
  newOneSidePosition: Keypair,
  connection: Connection
): Promise<void> {
  const totalIntervalRange = 10;
  const activeBin = await dlmm.getActiveBin();
  const maxBinId = activeBin.binId + totalIntervalRange;
  const minBinId = activeBin.binId - totalIntervalRange;
  const totalXAmount = new BN(0);
  const totalYAmount = new BN(100 * 10 ** 6);

  // Add Liquidity to existing position
  // Add Liquidity to existing position
  const addLiquidityTx = await dlmm.addLiquidityByStrategy({
    positionPubKey: newOneSidePosition.publicKey,
    user: user.publicKey,
    totalXAmount,
    totalYAmount,
    strategy: {
      maxBinId,
      minBinId,
      strategyType: 0, // can be StrategyType.Spot, StrategyType.BidAsk, StrategyType.Curve
    },
  });

  try {
    const addLiquidityTxHash = await sendAndConfirmTransaction(
      connection,
      addLiquidityTx,
      [user]
    );
    console.log("🚀 ~ addLiquidityTxHash:", addLiquidityTxHash);
  } catch (error) {
    console.log("🚀 ~ addLiquidityToExistingPosition::error:", JSON.parse(JSON.stringify(error)));
  }
}

interface Positions {
  userPositions: LbPosition[];
}

async function removeLiquidity(
  dlmm: DLMM,
  user: Keypair,
  positions: Positions,
  connection: Connection
): Promise<void> {
  // Remove Liquidity
  const userPositions = positions.userPositions;
  const removeLiquidityTxs = (
    await Promise.all(
      userPositions.map((position) => {
        const binIdsToRemove = position.positionData.positionBinData.map(
          (bin) => bin.binId
        );
        return dlmm.removeLiquidity({
          position: position.publicKey,
          user: user.publicKey,
          fromBinId: binIdsToRemove[0],
          toBinId: binIdsToRemove[binIdsToRemove.length - 1],
          bps: new BN(100 * 100),
          shouldClaimAndClose: true,
        });
      })
    )
  ).flat();

  try {
    for (let tx of removeLiquidityTxs) {
      const removeBalanceLiquidityTxHash = await sendAndConfirmTransaction(
        connection,
        tx,
        [user],
        { skipPreflight: false, preflightCommitment: "confirmed" }
      );
      console.log(
        "🚀 ~ removeBalanceLiquidityTxHash:",
        removeBalanceLiquidityTxHash
      );
    }
  } catch (error) {
    console.log("🚀 ~ removePositionLiquidity::error:", JSON.parse(JSON.stringify(error)));
  }
}

async function swap(dlmm: DLMM, user: Keypair, connection: Connection, amount: BN, swapYToX: boolean): Promise<void> {
  try {
    const amountStr = amount.toString();
    const USDC_ADDRESS = dlmm.tokenX.publicKey.toString();
    const SOL_ADDRESS = '11111111111111111111111111111111';
    console.log("USDC_ADDRESS", USDC_ADDRESS);
    console.log("SOL_ADDRESS", SOL_ADDRESS);
    
    const routes = await getRoutes({
      fromChainId: 1151111081099710, // Solana chain ID
      toChainId: 1151111081099710,
      fromTokenAddress: swapYToX ? SOL_ADDRESS : USDC_ADDRESS,
      toTokenAddress: swapYToX ? USDC_ADDRESS : SOL_ADDRESS,
      fromAmount: amountStr,
      fromAddress: user.publicKey.toString(),
      options: {
        slippage: 0.5,
        allowSwitchChain: false,
        integrator: 'Amubophis'
      }
    });

    if (!routes.routes.length) {
      throw new Error('No routes found for the swap');
    }

    const bestRoute = routes.routes[0];
    console.log("Swap route details:", {
      fromToken: bestRoute.fromToken.symbol,
      toToken: bestRoute.toToken.symbol,
      fromAmount: Number(bestRoute.fromAmount) / (swapYToX ? 1e9 : 1e6),
      toAmount: Number(bestRoute.toAmount) / (swapYToX ? 1e6 : 1e9),
      steps: bestRoute.steps.length
    });

    const executedRoute = await executeRoute(bestRoute, {
      updateRouteHook: (update) => {
        console.log("Route update:", {
          fromAmount: Number(update.fromAmount) / (swapYToX ? 1e9 : 1e6),
          toAmount: Number(update.toAmount) / (swapYToX ? 1e6 : 1e9),
        });
      },
    });

    console.log("Swap completed:", {
      txHash: executedRoute.steps[0].transactionRequest,
      fromAmount: Number(executedRoute.fromAmount) / (swapYToX ? 1e9 : 1e6),
      toAmount: Number(executedRoute.toAmount) / (swapYToX ? 1e6 : 1e9),
    });

  } catch (error: any) {
    console.error("Swap failed:", error);
    if (error.message) console.error("Error message:", error.message);
    if (error.code) console.error("Error code:", error.code);
    throw error;
  }
}

async function displayPositions(dlmm: DLMM, user: Keypair): Promise<void> {
  const positions = await dlmm.getPositionsByUserAndLbPair(user.publicKey);
  const userPositions = positions.userPositions;

  if (userPositions.length === 0) {
    console.log("No active positions found.");
    return;
  }

  const activeBin = await dlmm.getActiveBin();
  const activeBinId = activeBin.binId;

  console.log("\nActive Positions:");
  console.log("-".repeat(50));
  console.log(`Current Active Bin ID: ${activeBinId}`);
  console.log("-".repeat(50));

  for (let i = 0; i < userPositions.length; i++) {
    const position = userPositions[i];
    const lowerBin = position.positionData.lowerBinId;
    const upperBin = position.positionData.upperBinId;

    const isInRange = lowerBin <= activeBinId && activeBinId <= upperBin;
    const rangeStatus = isInRange ? "✅ IN RANGE" : "❌ OUT OF RANGE";

    console.log(`Position ${i + 1}:`);
    console.log(`Public Key: ${position.publicKey.toString()}`);
    console.log(`Total X Amount: ${position.positionData.totalXAmount.toString()}`);
    console.log(`Total Y Amount: ${position.positionData.totalYAmount.toString()}`);
    console.log(`Number of Bins: ${position.positionData.positionBinData.length}`);
    console.log(`Lower Bin: ${lowerBin}`);
    console.log(`Upper Bin: ${upperBin}`);
    console.log(`Status: ${rangeStatus}`);

    if (!isInRange) {
      if (activeBinId < lowerBin) {
        console.log(`Position is ${lowerBin - activeBinId} bins below current range`);
      } else {
        console.log(`Position is ${activeBinId - upperBin} bins above current range`);
      }
    }
    console.log("-".repeat(50));
  }
}

async function getTokenBalances(connection: Connection, user: Keypair, dlmm: DLMM): Promise<{ xBalance: BN, yBalance: BN, xDecimals: number, yDecimals: number }> {
  // For USDC (X token) - it's an SPL token
  const xAccount = await connection.getTokenAccountsByOwner(user.publicKey, { mint: dlmm.tokenX.publicKey });
  const xMint = await getMint(connection, dlmm.tokenX.publicKey);
  
  // For SOL (Y token) - it's the native token, use getBalance
  const solBalance = await connection.getBalance(user.publicKey);
  const yMint = await getMint(connection, dlmm.tokenY.publicKey);
  
  console.log("Token X Account:", {
    pubkey: dlmm.tokenX.publicKey.toString(),
    account: xAccount.value[0]?.pubkey.toString()
  });
  console.log("Token Y - Native Balance:", solBalance / 1e9);

  // Get USDC balance from token account
  let xBalance = new BN(0);
  if (xAccount.value[0]) {
    const xAccountInfo = await connection.getAccountInfo(xAccount.value[0].pubkey);
    if (xAccountInfo) {
      const decodedXAccount = AccountLayout.decode(xAccountInfo.data);
      xBalance = new BN(decodedXAccount.amount);
      console.log("X Token Balance:", Number(xBalance.toString()) / 1e6);
    }
  }

  // Convert SOL balance to proper decimals (9 decimals for SOL)
  const yBalance = new BN(solBalance);
  console.log("Y Token Balance:", Number(yBalance.toString()) / 1e9);
  
  return { 
    xBalance, 
    yBalance, 
    xDecimals: xMint.decimals, 
    yDecimals: yMint.decimals 
  };
}

async function rebalanceAndCreateNewPosition(
  dlmm: DLMM,
  user: Keypair,
  positions: Positions,
  connection: Connection
): Promise<void> {
  // First remove liquidity
  await removeLiquidity(dlmm, user, positions, connection);

  // Get current balances and decimals
  const { xBalance, yBalance, xDecimals, yDecimals } = await getTokenBalances(connection, user, dlmm);

  // Get current price from active bin
  const activeBin = await dlmm.getActiveBin();
  if (!activeBin || activeBin.price === undefined) {
    throw new Error("Could not get active bin price");
  }

  const priceValue = Number(activeBin.price); // Convert to number explicitly
  const priceBN = new BN(Math.floor(priceValue * 1e6)); // Now safe to do arithmetic

  // Log the raw price for debugging
  console.log("Raw price from active bin:", activeBin.price);

  // Calculate USD value of each token (using proper scaling)
  // For SOL->USDC, we multiply by price
  // For USDC->SOL, we divide by price
  const xValue = xBalance; // USDC value is already in USD
  const yValue = yBalance.mul(priceBN).div(new BN(1e6)); // Convert SOL to USD value

  const totalValue = xValue.add(yValue);
  const targetValue = totalValue.div(new BN(2));

  console.log("Current balances and values:", {
    xBalance: Number(xBalance.toString()) / 1e6,
    yBalance: Number(yBalance.toString()) / 1e9,
    xValue: Number(xValue.toString()) / 1e6,
    yValue: Number(yValue.toString()) / 1e6,
    totalValue: Number(totalValue.toString()) / 1e6,
    targetValue: Number(targetValue.toString()) / 1e6,
    currentPrice: activeBin.price
  });

  // Determine which token to swap and how much
  let swapAmount: BN;
  let swapYToX: boolean;

  if (xValue.gt(yValue)) {
    // Need to swap X to Y (USDC to SOL)
    swapAmount = xBalance.div(new BN(2));
    swapYToX = false;
  } else {
    // Need to swap Y to X (SOL to USDC)
    swapAmount = yBalance.div(new BN(2));
    swapYToX = true;
  }

  // Calculate expected output for logging
  const expectedOutput = swapYToX 
    ? swapAmount.mul(priceBN).div(new BN(1e6)) // SOL to USDC
    : swapAmount.mul(new BN(1e6)).div(priceBN); // USDC to SOL

  // Only swap if the amount is significant (more than 1% of total value)
  const minSwapThreshold = totalValue.div(new BN(100));
  const valueToCheck = swapYToX ? yValue : xValue;
  
  if (swapAmount.gt(new BN(0)) && valueToCheck.gt(minSwapThreshold)) {
    console.log("Swap calculation details:", {
      calculatedSwapAmount: swapYToX ? Number(swapAmount.toString()) / 1e9 : Number(swapAmount.toString()) / 1e6,
      availableBalance: swapYToX ? Number(yBalance.toString()) / 1e9 : Number(xBalance.toString()) / 1e6,
      currentPrice: activeBin.price,
      direction: swapYToX ? "Y to X (SOL to USDC)" : "X to Y (USDC to SOL)",
      expectedOutput: swapYToX 
        ? Number(expectedOutput.toString()) / 1e6 + " USDC"
        : Number(expectedOutput.toString()) / 1e9 + " SOL"
    });

    // Execute a single large swap
    console.log("final swapAmount", swapAmount.toString());
    await swap(dlmm, user, connection, swapAmount, swapYToX);
  } else {
    console.log("Skipping swap - amount too small or already balanced");
  }

    // Wait for a few seconds to let the blockchain update
    console.log("Waiting for balances to update...");
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Recheck balances after swap
    const { xBalance: updatedXBalance, yBalance: updatedYBalance } = await getTokenBalances(connection, user, dlmm);
    console.log("Updated balances after swap:", {
      xBalance: Number(updatedXBalance.toString()) / 1e6,
      yBalance: Number(updatedYBalance.toString()) / 1e9
    });

    // Reserve 0.07 SOL for fees
    const reservedSol = new BN(0.07 * 1e9); // 0.07 SOL in lamports
    const solToDeposit = updatedYBalance.gt(reservedSol) 
      ? updatedYBalance.sub(reservedSol) 
      : new BN(0);

    console.log("Position creation details:", {
      usdcToDeposit: Number(updatedXBalance.toString()) / 1e6,
      solToDeposit: Number(solToDeposit.toString()) / 1e9,
      reservedSol: Number(reservedSol.toString()) / 1e9
    });

    // Create new position with updated balances, reserving SOL for fees
    const newPosition = Keypair.generate();
    await initializePosition(dlmm, user, newPosition, connection, updatedXBalance, solToDeposit);
}

async function main(): Promise<void> {
  const { connection, dlmm } = await initializeClient();
  const user = getUserKeypair();
  const newOnesidePosition = Keypair.generate();

  while (true) {
    console.log("\nMenu:");
    console.log("1. Initialize Position");
    console.log("2. Add Liquidity");
    console.log("3. Remove Liquidity");
    console.log("4. Swap");
    console.log("5. Display Active Positions");
    console.log("6. Rebalance and Create New Position");
    console.log("7. Exit");

    const choice = await new Promise<string>((resolve) => {
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim());
      });
    });

    switch (choice) {
      case '1':
        await initializePosition(dlmm, user, newOnesidePosition, connection);
        break;
      case '2':
        const positions2 = await dlmm.getPositionsByUserAndLbPair(user.publicKey);
        await addLiquidity(dlmm, user, newOnesidePosition, connection);
        break;
      case '3':
        const positions3 = await dlmm.getPositionsByUserAndLbPair(user.publicKey);
        await removeLiquidity(dlmm, user, positions3, connection);
        break;
      case '4':
        await swap(dlmm, user, connection, new BN(100), true);
        break;
      case '5':
        await displayPositions(dlmm, user);
        break;
      case '6':
        const positions6 = await dlmm.getPositionsByUserAndLbPair(user.publicKey);
        await rebalanceAndCreateNewPosition(dlmm, user, positions6, connection);
        break;
      case '7':
        process.exit(0);
      default:
        console.log("Invalid choice. Please try again.");
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export {
  initializeClient,
  getUserKeypair,
  initializePosition,
  addLiquidity,
  removeLiquidity,
  swap,
  displayPositions,
  main
}; 