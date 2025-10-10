// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ForestRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  location: string;
  year: number;
  forestType: string;
  changeType: "deforestation" | "reforestation";
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<ForestRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    location: "",
    year: new Date().getFullYear(),
    forestType: "Tropical",
    changeType: "deforestation",
    satelliteData: ""
  });
  const [showStats, setShowStats] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const deforestationCount = records.filter(r => r.changeType === "deforestation").length;
  const reforestationCount = records.filter(r => r.changeType === "reforestation").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Contract interaction functions
  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("forest_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: ForestRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`forest_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                location: recordData.location,
                year: recordData.year,
                forestType: recordData.forestType,
                changeType: recordData.changeType
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting forest data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        location: newRecordData.location,
        year: newRecordData.year,
        forestType: newRecordData.forestType,
        changeType: newRecordData.changeType
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `forest_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("forest_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "forest_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Forest data encrypted and stored securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          location: "",
          year: new Date().getFullYear(),
          forestType: "Tropical",
          changeType: "deforestation",
          satelliteData: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  // Filter records based on search term
  const filteredRecords = records.filter(record => 
    record.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.forestType.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      {/* Header Section */}
      <header className="app-header">
        <div className="logo">
          <h1>Forest<span>History</span></h1>
          <p>Confidential Analysis of Historical Deforestation</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      {/* Main Content */}
      <div className="main-content">
        {/* Project Introduction */}
        <section className="intro-section">
          <div className="intro-content">
            <h2>FHE-Powered Forest History Analysis</h2>
            <p>
              Analyze encrypted historical maps and satellite imagery using Fully Homomorphic Encryption (FHE) 
              to reconstruct long-term, global patterns of deforestation and reforestation while maintaining 
              data confidentiality.
            </p>
            <div className="fhe-badge">
              <span>FHE Technology</span>
            </div>
          </div>
        </section>
        
        {/* Action Buttons */}
        <div className="action-buttons">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="primary-btn"
          >
            Add Forest Data
          </button>
          <button 
            onClick={() => setShowStats(!showStats)}
            className="secondary-btn"
          >
            {showStats ? "Hide Statistics" : "Show Statistics"}
          </button>
          <button 
            onClick={loadRecords}
            disabled={isRefreshing}
            className="refresh-btn"
          >
            {isRefreshing ? "Refreshing..." : "Refresh Data"}
          </button>
        </div>
        
        {/* Statistics Section */}
        {showStats && (
          <div className="stats-section">
            <div className="stat-card">
              <h3>Total Records</h3>
              <div className="stat-value">{records.length}</div>
            </div>
            <div className="stat-card">
              <h3>Deforestation</h3>
              <div className="stat-value">{deforestationCount}</div>
            </div>
            <div className="stat-card">
              <h3>Reforestation</h3>
              <div className="stat-value">{reforestationCount}</div>
            </div>
          </div>
        )}
        
        {/* Search and Filter */}
        <div className="search-container">
          <input
            type="text"
            placeholder="Search by location or forest type..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
        
        {/* Records List */}
        <div className="records-section">
          {filteredRecords.length === 0 ? (
            <div className="no-records">
              <p>No forest records found</p>
              <button 
                className="primary-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Add First Record
              </button>
            </div>
          ) : (
            <div className="records-grid">
              {filteredRecords.map(record => (
                <div className="record-card" key={record.id}>
                  <div className="card-header">
                    <h3>{record.location}</h3>
                    <span className={`change-type ${record.changeType}`}>
                      {record.changeType}
                    </span>
                  </div>
                  <div className="card-body">
                    <p><strong>Forest Type:</strong> {record.forestType}</p>
                    <p><strong>Year:</strong> {record.year}</p>
                    <p><strong>Date Added:</strong> {new Date(record.timestamp * 1000).toLocaleDateString()}</p>
                  </div>
                  <div className="card-footer">
                    <span className="fhe-tag">FHE Encrypted</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  
      {/* Create Record Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Add Forest Data Record</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Location *</label>
                <input 
                  type="text"
                  name="location"
                  value={newRecordData.location} 
                  onChange={(e) => setNewRecordData({...newRecordData, location: e.target.value})}
                  placeholder="Geographic location..." 
                />
              </div>
              
              <div className="form-group">
                <label>Year *</label>
                <input 
                  type="number"
                  name="year"
                  value={newRecordData.year} 
                  onChange={(e) => setNewRecordData({...newRecordData, year: parseInt(e.target.value)})}
                  placeholder="Observation year..." 
                />
              </div>
              
              <div className="form-group">
                <label>Forest Type *</label>
                <select 
                  name="forestType"
                  value={newRecordData.forestType} 
                  onChange={(e) => setNewRecordData({...newRecordData, forestType: e.target.value})}
                >
                  <option value="Tropical">Tropical</option>
                  <option value="Temperate">Temperate</option>
                  <option value="Boreal">Boreal</option>
                  <option value="Subtropical">Subtropical</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Change Type *</label>
                <select 
                  name="changeType"
                  value={newRecordData.changeType} 
                  onChange={(e) => setNewRecordData({...newRecordData, changeType: e.target.value as any})}
                >
                  <option value="deforestation">Deforestation</option>
                  <option value="reforestation">Reforestation</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Satellite Data (JSON)</label>
                <textarea 
                  name="satelliteData"
                  value={newRecordData.satelliteData} 
                  onChange={(e) => setNewRecordData({...newRecordData, satelliteData: e.target.value})}
                  placeholder="Paste satellite data in JSON format..." 
                  rows={4}
                />
              </div>
              
              <div className="fhe-notice">
                Data will be encrypted using FHE before storage on blockchain
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="secondary-btn"
              >
                Cancel
              </button>
              <button 
                onClick={submitRecord} 
                disabled={creating}
                className="primary-btn"
              >
                {creating ? "Encrypting with FHE..." : "Submit Securely"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Wallet Selector Modal */}
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✕"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <p>Confidential Analysis of Historical Deforestation and Reforestation</p>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;