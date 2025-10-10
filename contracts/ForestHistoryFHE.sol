// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ForestHistoryFHE is SepoliaConfig {
    struct EncryptedDataset {
        uint256 id;
        euint32 encryptedMapData;
        euint32 encryptedSatelliteData;
        uint256 timestamp;
    }

    struct DecryptedDataset {
        string mapData;
        string satelliteData;
        bool isDecrypted;
    }

    uint256 public datasetCount;
    mapping(uint256 => EncryptedDataset) public encryptedDatasets;
    mapping(uint256 => DecryptedDataset) public decryptedDatasets;

    mapping(string => euint32) private encryptedAnalysisCount;
    string[] private analysisCategories;

    mapping(uint256 => uint256) private requestToDatasetId;

    event DatasetSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event DatasetDecrypted(uint256 indexed id);

    modifier onlyResearcher(uint256 datasetId) {
        _;
    }

    function submitEncryptedDataset(
        euint32 encryptedMapData,
        euint32 encryptedSatelliteData
    ) public {
        datasetCount += 1;
        uint256 newId = datasetCount;

        encryptedDatasets[newId] = EncryptedDataset({
            id: newId,
            encryptedMapData: encryptedMapData,
            encryptedSatelliteData: encryptedSatelliteData,
            timestamp: block.timestamp
        });

        decryptedDatasets[newId] = DecryptedDataset({
            mapData: "",
            satelliteData: "",
            isDecrypted: false
        });

        emit DatasetSubmitted(newId, block.timestamp);
    }

    function requestDatasetDecryption(uint256 datasetId) public onlyResearcher(datasetId) {
        EncryptedDataset storage ds = encryptedDatasets[datasetId];
        require(!decryptedDatasets[datasetId].isDecrypted, "Already decrypted");

        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(ds.encryptedMapData);
        ciphertexts[1] = FHE.toBytes32(ds.encryptedSatelliteData);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptDataset.selector);
        requestToDatasetId[reqId] = datasetId;

        emit DecryptionRequested(datasetId);
    }

    function decryptDataset(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 datasetId = requestToDatasetId[requestId];
        require(datasetId != 0, "Invalid request");

        EncryptedDataset storage eDs = encryptedDatasets[datasetId];
        DecryptedDataset storage dDs = decryptedDatasets[datasetId];
        require(!dDs.isDecrypted, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory results = abi.decode(cleartexts, (string[]));
        dDs.mapData = results[0];
        dDs.satelliteData = results[1];
        dDs.isDecrypted = true;

        if (!FHE.isInitialized(encryptedAnalysisCount[results[1]])) {
            encryptedAnalysisCount[results[1]] = FHE.asEuint32(0);
            analysisCategories.push(results[1]);
        }
        encryptedAnalysisCount[results[1]] = FHE.add(
            encryptedAnalysisCount[results[1]],
            FHE.asEuint32(1)
        );

        emit DatasetDecrypted(datasetId);
    }

    function getDecryptedDataset(uint256 datasetId) public view returns (
        string memory mapData,
        string memory satelliteData,
        bool isDecrypted
    ) {
        DecryptedDataset storage ds = decryptedDatasets[datasetId];
        return (ds.mapData, ds.satelliteData, ds.isDecrypted);
    }

    function getEncryptedAnalysisCount(string memory category) public view returns (euint32) {
        return encryptedAnalysisCount[category];
    }

    function requestAnalysisCountDecryption(string memory category) public {
        euint32 count = encryptedAnalysisCount[category];
        require(FHE.isInitialized(count), "Category not found");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAnalysisCount.selector);
        requestToDatasetId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(category)));
    }

    function decryptAnalysisCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 categoryHash = requestToDatasetId[requestId];
        string memory category = getCategoryFromHash(categoryHash);

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 count = abi.decode(cleartexts, (uint32));
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getCategoryFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < analysisCategories.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(analysisCategories[i]))) == hash) {
                return analysisCategories[i];
            }
        }
        revert("Category not found");
    }
}
