.PHONY: help install build test fuzz invariant fork slither coverage gas verify deploy-sepolia clean

help:
	@echo "Vault-Kit verification & deployment targets"
	@echo ""
	@echo "  make install         Install Foundry (requires curl + bash)"
	@echo "  make build           forge build --sizes"
	@echo "  make test            forge test -vv (unit + fuzz)"
	@echo "  make fuzz            forge test with 10k fuzz runs"
	@echo "  make invariant       forge test --match-contract Invariant"
	@echo "  make fork            forge test --match-contract Fork (needs ARBITRUM_RPC_URL)"
	@echo "  make slither         slither static analysis"
	@echo "  make coverage        forge coverage"
	@echo "  make gas             forge snapshot"
	@echo "  make verify          build + test + fuzz + invariant + slither (local full pass)"
	@echo "  make deploy-sepolia  forge script DeploySepolia.s.sol --broadcast"
	@echo "  make clean           remove build artifacts"
	@echo ""
	@echo "Secrets / env vars — set in your shell or .env:"
	@echo "  ARBITRUM_RPC_URL        (fork tests)"
	@echo "  ARBITRUM_SEPOLIA_RPC_URL (sepolia deploy)"
	@echo "  DEPLOYER_PRIVATE_KEY    (sepolia deploy)"
	@echo "  GUARDIAN_ADDRESS        (sepolia deploy)"
	@echo "  FEE_RECIPIENT           (sepolia deploy)"
	@echo "  SEPOLIA_USDC_ADDRESS    (defaults to Circle USDC)"
	@echo "  ARBISCAN_API_KEY        (contract verification)"
	@echo ""
	@echo "CI does all of this automatically on push — see docs/VERIFICATION.md"

install:
	curl -L https://foundry.paradigm.xyz | bash
	@echo "Run: foundryup  (add ~/.foundry/bin to PATH if needed)"

build:
	forge build --sizes

test:
	forge test -vv --no-match-contract "Invariant|Fork"

fuzz:
	FOUNDRY_FUZZ_RUNS=10000 forge test -vv --no-match-contract "Invariant|Fork"

invariant:
	FOUNDRY_INVARIANT_RUNS=1000 FOUNDRY_INVARIANT_DEPTH=100 forge test --match-contract Invariant -vv

fork:
	@if [ -z "$$ARBITRUM_RPC_URL" ]; then \
		echo "ARBITRUM_RPC_URL not set. Export it or add to your .env."; \
		exit 1; \
	fi
	forge test --match-contract Fork --fork-url $$ARBITRUM_RPC_URL -vv

slither:
	slither .

coverage:
	forge coverage --report summary --report lcov --no-match-coverage "(test|script)"

gas:
	forge snapshot

verify: build test fuzz invariant slither
	@echo ""
	@echo "=== Local verification complete ==="
	@echo "Run 'make fork' with ARBITRUM_RPC_URL set for live Arbitrum integration tests."

deploy-sepolia:
	@if [ -z "$$DEPLOYER_PRIVATE_KEY" ]; then \
		echo "DEPLOYER_PRIVATE_KEY not set"; exit 1; \
	fi
	@if [ -z "$$ARBITRUM_SEPOLIA_RPC_URL" ]; then \
		echo "ARBITRUM_SEPOLIA_RPC_URL not set"; exit 1; \
	fi
	forge script script/DeploySepolia.s.sol:DeploySepoliaScript \
		--rpc-url $$ARBITRUM_SEPOLIA_RPC_URL \
		--broadcast \
		-vvv

clean:
	forge clean
	rm -rf broadcast cache out lcov.info .gas-snapshot
