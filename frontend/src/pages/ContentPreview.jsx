import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Save, Check, Search, Maximize, ExternalLink, Globe, FileText, Image as ImageIcon, Sparkles, Loader2, PlayCircle, StopCircle, RefreshCcw, ChevronLeft, ChevronRight, Heart, Share2, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import ActiveFitnessPreview from '../components/ActiveFitnessPreview';

export default function ContentPreview() {
  const { jobId } = useParams();
  const [searchParams] = useSearchParams();
  const taskName = searchParams.get('taskName') || 'Review Extraction Data';
  const navigate = useNavigate();
  const tabParam = searchParams.get('tab') || 'table';
  const [activeTab, setActiveTab] = useState(tabParam); // 'json' | 'table' | 'product' | 'ai'
  const [job, setJob] = useState(null);
  const [jsonData, setJsonData] = useState('');
  const [loading, setLoading] = useState(true);
  const [realAssets, setRealAssets] = useState([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [bundles, setBundles] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem('contentPreview_sidebarOpen') !== 'false'; } catch { return true; }
  });

  const toggleSidebar = () => {
    setSidebarOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('contentPreview_sidebarOpen', String(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    if (taskName) {
      api.get(`/jobs/?task_name=${encodeURIComponent(taskName)}`)
        .then(res => {
          const activeJobs = (res.data.jobs || []).filter(j => !['completed', 'aborted', 'failed', 'removed'].includes(j.status));
          setBundles(activeJobs);
        })
        .catch(err => console.error(err));
    }
  }, [taskName, jobId]);

  const currentJobIdRef = React.useRef(jobId);

  // Strictly invalidate the state buffer on route/jobId changes
  useEffect(() => {
    currentJobIdRef.current = jobId;
    setJob(null);
    setJsonData('');
    setRealAssets([]);
  }, [jobId]);

  useEffect(() => {
    const fetchJob = async () => {
      try {
        const res = await api.get(`/jobs/detail/${jobId}`);
        // Prevent race condition if the user navigated away before this API call finished
        if (currentJobIdRef.current !== jobId) return;
        
        setJob(res.data);
        
        // Only set jsonData on initial load or if the buffer was just cleared
        setJsonData(prev => prev ? prev : JSON.stringify(res.data.product_data || {}, null, 2));
        
        // Parse images from AI JSON
        const imagesDict = res.data.product_data?.images || {};
        const lifestyle = imagesDict.lifestyle_images || [];
        const feature = imagesDict.feature_images || [];
        
        let combined = [
          ...lifestyle.map((img, i) => ({
            id: `LIFESTYLE_${i}`,
            url: `http://localhost:8000/${img.local_path}`,
          })),
          ...feature.map((img, i) => ({
            id: `FEATURE_${i}`,
            url: `http://localhost:8000/${img.local_path}`,
          }))
        ];
        
        if (combined.length === 0 && imagesDict.scraped_images) {
           combined.push(...imagesDict.scraped_images.map((img, i) => ({
             id: `SCRAPED_${i}`,
             url: img.url
           })));
        }

        setRealAssets(combined);
      } catch (err) {
        console.error("Failed to fetch job", err);
      } finally {
        if (currentJobIdRef.current === jobId) {
          setLoading(false);
        }
      }
    };
    
    fetchJob();

    const pollJob = async () => {
      try {
        const res = await api.get(`/jobs/detail/${jobId}`);
        if (currentJobIdRef.current !== jobId) return;
        
        const currentData = res.data.product_data || {};
        
        // 1. Rebuild realAssets from the live JSON
        const imagesDict = currentData.images || {};
        const lifestyle = imagesDict.lifestyle_images || [];
        const feature = imagesDict.feature_images || [];
        
        let combined = [
          ...lifestyle.map((img, i) => ({
            id: `LIFESTYLE_${i}`,
            url: `http://localhost:8000/${img.local_path}`,
          })),
          ...feature.map((img, i) => ({
            id: `FEATURE_${i}`,
            url: `http://localhost:8000/${img.local_path}`,
          }))
        ];
        
        if (combined.length === 0 && imagesDict.scraped_images) {
           combined.push(...imagesDict.scraped_images.map((img, i) => ({
             id: `SCRAPED_${i}`,
             url: img.url
           })));
        }
        
        setRealAssets(prev => JSON.stringify(prev) !== JSON.stringify(combined) ? combined : prev);
        
        // 2. Merge the live images dictionary into the user's current jsonData
        setJsonData(prevJsonStr => {
          try {
            if (!prevJsonStr) return prevJsonStr; // skip if buffer is empty
            const parsed = JSON.parse(prevJsonStr);
            if (JSON.stringify(parsed.images) !== JSON.stringify(imagesDict)) {
              parsed.images = imagesDict;
              return JSON.stringify(parsed, null, 2);
            }
            return prevJsonStr;
          } catch (e) {
            return prevJsonStr;
          }
        });
        
        // 3. Update the job state itself
        setJob(prev => {
           if (JSON.stringify(prev?.product_data?.images) !== JSON.stringify(imagesDict)) {
             return res.data;
           }
           return prev;
        });
        
      } catch (err) {}
    };
    
    const interval = setInterval(pollJob, 3000);
    return () => clearInterval(interval);
  }, [jobId]);

  if (loading) {
    return (
      <div className="h-[calc(100vh-8rem)] -m-4 md:-m-6 flex items-center justify-center bg-slate-50">
        <Loader2 size={32} className="animate-spin text-indigo-600" />
      </div>
    );
  }

  const aiData = job?.product_data || {};
  const productIdentity = aiData.product_identity || {};

  const updateJsonPath = (path, value) => {
    try {
      const newParsed = JSON.parse(jsonData);
      let current = newParsed;
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]];
      }
      current[path[path.length - 1]] = value;
      setJsonData(JSON.stringify(newParsed, null, 2));
    } catch (e) {
      console.error(e);
    }
  };

  const renderRecursiveEditor = (data, path = []) => {
    if (data === null || data === undefined) {
      return (
        <input 
          className="w-full text-sm border-slate-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border bg-white focus:outline-none"
          value=""
          placeholder="null"
          onChange={(e) => updateJsonPath(path, e.target.value)}
        />
      );
    }

    if (Array.isArray(data)) {
      return (
        <div className="flex flex-col gap-3 pl-4 border-l-2 border-indigo-200 mt-1 mb-2">
          {data.map((item, idx) => (
            <div key={idx} className="flex gap-3 items-start bg-slate-50/50 p-2 rounded border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 mt-2 w-4 shrink-0">{idx + 1}.</span>
              <div className="flex-1">
                {renderRecursiveEditor(item, [...path, idx])}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (typeof data === 'object') {
      return (
        <div className="flex flex-col gap-4 pl-4 border-l-2 border-slate-200 mt-2 mb-3 w-full">
          {Object.entries(data).map(([key, val]) => (
            <div key={key} className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-600 tracking-wide uppercase">{key.replace(/_/g, ' ')}</label>
              {renderRecursiveEditor(val, [...path, key])}
            </div>
          ))}
        </div>
      );
    }

    // Primitive (string, number, boolean)
    return (
      <textarea 
        value={data}
        rows={String(data).length > 80 ? 3 : 1}
        onChange={(e) => {
          let val = e.target.value;
          if (typeof data === 'number') val = Number(val) || 0;
          if (typeof data === 'boolean') val = val === 'true';
          updateJsonPath(path, val);
        }}
        className="w-full text-sm border-slate-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border bg-white focus:outline-none transition-shadow"
      />
    );
  };

  const filteredBundles = bundles.filter(b => {
    const searchStr = searchQuery.toLowerCase();
    const bTaskName = (b.task_name || '').toLowerCase();
    const prodName = (b.product_data?.product_identity?.product_name || b.product_data?.product_identity?.brand || '').toLowerCase();
    return bTaskName.includes(searchStr) || prodName.includes(searchStr);
  });

  const handleSelectJob = (selected) => {
    if (selected.id !== jobId) {
      navigate(`/task-logs/content-preview/${selected.id}?taskName=${encodeURIComponent(taskName)}&tab=${activeTab}`);
    }
  };

  const handleSaveChanges = async () => {
    setSaving(true);
    try {
      await api.post(`/jobs/${jobId}/update_data`, { product_data: JSON.parse(jsonData) });
    } catch (e) {
      console.error(e);
      alert("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const handleFinalizeAndSave = async () => {
    setSaving(true);
    try {
      // 1. Save manual JSON edits
      await api.post(`/jobs/${jobId}/approve`, { product_data: JSON.parse(jsonData) });
      
      // 2. Embed generated AI images into the database product_data if applicable
      if (job?.status === 'image_generation_complete' || (job?.generate_ai_images && job?.status !== 'success')) {
        try {
          await api.post(`/images/job/${jobId}/finish`);
        } catch (e) {
          console.error("Failed to finish images", e);
        }
      }
      
      // 3. Finalize bundle (generates ZIP and makes it available in Downloads tab)
      // Sending an empty object so it doesn't overwrite the images just injected by /finish
      await api.post(`/jobs/${jobId}/finalize`, {});
      
      alert('Bundle Finalized and Saved successfully! It has been moved to the Downloads tab.');
      
      // Invalidate local cache/buffer
      setJob(null);
      setJsonData('');
      setRealAssets([]);
      
      const activeBundles = bundles.filter(b => b.id !== jobId && !['completed', 'aborted', 'failed', 'removed'].includes(b.status));
      if (activeBundles.length > 0) {
        navigate(`/task-logs/content-preview/${activeBundles[0].id}?taskName=${encodeURIComponent(taskName)}&tab=${activeTab}`);
      } else {
        navigate(`/task-logs?taskName=${encodeURIComponent(taskName)}`);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to finalize bundle.");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateAiImages = async () => {
    setSaving(true);
    try {
      // Ensure the JSON is saved/approved before deepseek starts writing prompts
      await api.post(`/jobs/${jobId}/approve`, { product_data: JSON.parse(jsonData) });
      
      // Kick off the generation
      await api.post(`/images/job/${jobId}/resume`);
      
      // Navigate to the Image Review tab to wait for the Shimmer effect to finish
      navigate(`/task-logs/ai-images/${jobId}?taskName=${encodeURIComponent(taskName)}`);
    } catch (e) {
      console.error(e);
      alert("Failed to start AI image generation.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveBundle = async () => {
    if (!window.confirm("Are you sure you want to remove this bundle?")) return;
    setSaving(true);
    try {
      await api.delete(`/jobs/${jobId}`);
      
      // Invalidate local cache/buffer
      setJob(null);
      setJsonData('');
      setRealAssets([]);
      
      const activeBundles = bundles.filter(b => b.id !== jobId && !['completed', 'aborted', 'failed', 'removed'].includes(b.status));
      if (activeBundles.length > 0) {
        navigate(`/task-logs/content-preview/${activeBundles[0].id}?taskName=${encodeURIComponent(taskName)}&tab=${activeTab}`);
      } else {
        navigate(`/task-logs?taskName=${encodeURIComponent(taskName)}`);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to remove.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full w-full bg-slate-50 flex flex-col md:flex-row text-sm overflow-hidden z-0">
      {/* Sidebar */}
      <div
        className={clsx(
          "flex-shrink-0 border-b md:border-b-0 md:border-r border-slate-200 bg-white flex flex-col shadow-sm z-20 transition-all duration-200 ease-in-out",
          sidebarOpen ? "w-full md:w-64" : "w-0 md:w-0 overflow-hidden border-r-0"
        )}
      >
        <div className="p-3 border-b border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search bundles..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-100 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-md text-sm transition-all outline-none"
            />
          </div>
        </div>
        
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
          <span className="text-xs font-bold text-slate-500 tracking-wider truncate mr-2" title={taskName}>{taskName}</span>
          <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-bold shrink-0">{bundles.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredBundles.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No products found.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredBundles.map(b => {
                const isActive = job?.id === b.id;
                const bProdName = b.product_data?.product_identity?.product_name || b.product_data?.product_identity?.brand || "Unknown Product";
                
                return (
                  <li key={b.id}>
                    <button
                      onClick={() => handleSelectJob(b)}
                      className={clsx(
                        "w-full text-left p-3 hover:bg-slate-50 transition-colors focus:outline-none flex flex-col gap-1",
                        isActive ? "bg-indigo-50/50 border-l-4 border-indigo-500" : "border-l-4 border-transparent"
                      )}
                    >
                      <div className="flex justify-between items-start w-full">
                        <h4 className="font-semibold text-slate-800 text-sm truncate pr-2">{bProdName}</h4>
                        {isActive && <span className="bg-green-100 text-green-700 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0">Active</span>}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                        <Check size={10} /> Updated {new Date(b.updated_at || b.created_at).toLocaleDateString()}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Action Panel */}
        {job && (
          <div className="p-4 bg-white border-t border-slate-200 flex flex-col gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] shrink-0">
            <div>
              <h5 className="text-[10px] font-bold text-slate-500 tracking-wider mb-2">PRODUCT SUMMARY</h5>
              <div className="text-xs">
                <div className="mb-1"><span className="text-slate-400 text-[10px]">TASK NAME:</span><br/><span className="font-medium text-slate-700 truncate block">{job.task_name}</span></div>
                <div><span className="text-slate-400 text-[10px]">BRAND:</span><br/><span className="font-medium text-slate-700 truncate block">{job.product_data?.product_identity?.brand || "Unknown"}</span></div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleFinalizeAndSave}
                disabled={saving}
                className="w-full py-2 px-3 bg-[#5235e8] text-white rounded-md text-xs font-semibold hover:bg-[#4323c2] transition-colors flex justify-center items-center gap-2"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                FINALIZE AND SAVE
              </button>
              <button
                onClick={handleRemoveBundle}
                disabled={saving}
                className="w-full py-2 px-3 bg-rose-50 text-rose-600 border border-rose-200 rounded-md text-xs font-semibold hover:bg-rose-100 transition-colors flex justify-center items-center gap-2 mt-2"
              >
                <Trash2 size={14} />
                REMOVE BUNDLE
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar Toggle Button — anchored at the sidebar/content boundary */}
      <div className="hidden md:flex items-center justify-center relative z-30 flex-shrink-0">
        <button
          onClick={toggleSidebar}
          title={sidebarOpen ? 'Hide Task List' : 'Show Task List'}
          className={clsx(
            "absolute left-0 -translate-x-1/2 rounded-full w-12 h-12 flex items-center justify-center transition-all duration-200",
            "bg-green-500 text-white border-2 border-white",
            "shadow-[0_0_15px_rgba(34,197,94,0.5)] hover:shadow-[0_0_20px_rgba(34,197,94,0.7)] hover:bg-green-400 hover:scale-105 active:scale-95"
          )}
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-[600px] md:min-h-0 md:h-full relative overflow-hidden">
        
        {/* Top Navigation Tabs */}
      <div className="bg-white px-6 border-b border-slate-200 shrink-0 flex flex-wrap items-center justify-between gap-y-2 gap-x-4">
        <div className="flex flex-wrap -mb-px">
          <button 
            onClick={() => setActiveTab('json')}
            className={clsx(
              "px-5 py-4 text-sm font-bold border-b-2 transition-colors",
              activeTab === 'json' ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            Edit Generated JSON
          </button>
          <button 
            onClick={() => setActiveTab('table')}
            className={clsx(
              "px-5 py-4 text-sm font-bold border-b-2 transition-colors",
              activeTab === 'table' ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            Table View
          </button>
          <button 
            onClick={() => setActiveTab('product')}
            className={clsx(
              "px-5 py-4 text-sm font-bold border-b-2 transition-colors",
              activeTab === 'product' ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            Product Page
          </button>
          <button 
            onClick={() => setActiveTab('ai')}
            className={clsx(
              "px-5 py-4 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors",
              activeTab === 'ai' ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            <Sparkles size={16} className="text-amber-500" />
            ✨ AI GENERATED PAGE
          </button>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 ml-auto py-2">
          <button
            onClick={handleSaveChanges}
            disabled={saving}
            className="py-1.5 px-4 bg-white border border-slate-300 text-slate-700 rounded-md text-xs font-semibold hover:bg-slate-50 transition-colors flex justify-center items-center gap-2 shadow-sm"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            SAVE CHANGES
          </button>

          {job?.generate_ai_images && (
            <>
              {['image_generation', 'image_generation_stopped', 'image_generation_complete', 'image_generation_failed'].includes(job?.status) ? (
                <button
                  onClick={() => navigate(`/task-logs/ai-images/${jobId}?taskName=${encodeURIComponent(taskName)}`)}
                  className="py-1.5 px-4 bg-[#00A389]/10 text-[#00A389] border border-[#00A389]/30 rounded-md text-xs font-semibold hover:bg-[#00A389]/20 transition-colors flex justify-center items-center gap-2 shadow-sm"
                >
                  <ImageIcon size={14} />
                  IMAGE REVIEW
                </button>
              ) : (
                <button
                  onClick={handleGenerateAiImages}
                  disabled={saving}
                  className="py-1.5 px-4 bg-[#00A389]/10 text-[#00A389] border border-[#00A389]/30 rounded-md text-xs font-semibold hover:bg-[#00A389]/20 transition-colors flex justify-center items-center gap-2 shadow-sm"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                  GENERATE AI IMAGES
                </button>
              )}
            </>
          )}

          {activeTab === 'ai' && (
            <button 
              onClick={() => setIsFullscreen(true)}
              className="flex items-center gap-1.5 text-slate-500 text-sm font-semibold hover:text-slate-800 transition-colors ml-2"
            >
              <Maximize size={16} /> Fullscreen
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
        
        {/* TAB 1: Edit Generated JSON */}
        {activeTab === 'json' && (
          <div className="max-w-5xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between bg-slate-50 px-4 py-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <Globe size={18} className="text-indigo-600" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Original Source</h3>
                    <p className="text-xs text-slate-500 truncate max-w-lg">{job?.url}</p>
                  </div>
                </div>
                <a href={job?.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white rounded-md text-xs font-bold hover:bg-slate-700 transition-colors">
                  Open in New Tab <ExternalLink size={14} />
                </a>
              </div>
              <textarea 
                className="w-full h-[600px] font-mono text-sm p-4 resize-none focus:outline-none focus:ring-0 bg-[#1e1e1e] text-emerald-400"
                value={jsonData}
                onChange={e => setJsonData(e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {/* TAB 2: Table View */}
        {activeTab === 'table' && (
          <div className="max-w-[1400px] mx-auto h-[700px] overflow-hidden flex flex-col space-y-4">
            <div className="grid grid-cols-2 gap-6 h-full overflow-hidden">
              {/* Left Column: AI Generated (Editable) */}
              <div className="flex flex-col h-full bg-slate-100 rounded-xl border border-slate-200 overflow-hidden shadow-sm relative">
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center shadow-sm z-10">
                  <svg className="w-5 h-5 text-indigo-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  <h3 className="font-bold text-slate-800 text-sm">AI Generated</h3>
                </div>
                <div className="p-6 overflow-auto flex-1">
                  <div className="min-w-[600px]">
                  {(() => {
                    let parsed = {};
                    let isValid = true;
                    try {
                      parsed = JSON.parse(jsonData);
                      if (typeof parsed !== 'object' || parsed === null) throw new Error();
                    } catch (e) {
                      isValid = false;
                    }

                    if (!isValid) {
                      return (
                        <div className="flex items-center justify-center h-full text-red-500 text-sm">
                          Invalid JSON format.
                        </div>
                      );
                    }

                    if (Object.keys(parsed).length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm">
                          <p>The JSON object is empty.</p>
                        </div>
                      );
                    }

                    return (
                      <>
                        {Object.entries(parsed).map(([key, val]) => (
                          <div key={key} className="mb-6 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                            <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
                              <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{key.replace(/_/g, ' ')}</h4>
                            </div>
                            <div className="p-4">
                              {renderRecursiveEditor(val, [key])}
                            </div>
                          </div>
                        ))}
                      </>
                    );
                  })()}
                  </div>
                </div>
              </div>

              {/* Right Column: Source HTML (Read Only) */}
              <div className="flex flex-col h-full bg-[#1e1e1e] rounded-xl border border-slate-200 overflow-hidden shadow-sm relative">
                <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center shadow-sm z-10">
                  <svg className="w-5 h-5 text-slate-400 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                  <h3 className="font-bold text-slate-200 text-sm">Source HTML</h3>
                </div>
                <div className="p-4 overflow-auto flex-1">
                  {(() => {
                    const rawHtml = job?.raw_html;
                    if (!rawHtml) {
                      return (
                        <div className="flex items-center justify-center h-full text-slate-500 text-sm italic">
                          No source HTML available for this task.
                        </div>
                      );
                    }
                    
                    let formatted = '';
                    try {
                      let pad = 0;
                      const tokens = rawHtml.replace(/>\s+</g, '><').split(/(?=<)|(?<=>)/);
                      
                      for (let i = 0; i < tokens.length; i++) {
                        let token = tokens[i].trim();
                        if (!token) continue;
                        
                        if (token.startsWith('</')) {
                          pad = Math.max(0, pad - 1);
                          formatted += '  '.repeat(pad) + token + '\n';
                        } else if (token.startsWith('<') && !token.startsWith('<!') && !token.startsWith('<?') && !token.endsWith('/>')) {
                          const isSelfClosing = token.match(/^<(img|input|br|hr|meta|link|base|col|command|embed|keygen|param|source|track|wbr)/i);
                          formatted += '  '.repeat(pad) + token + '\n';
                          if (!isSelfClosing) pad++;
                        } else {
                          formatted += '  '.repeat(pad) + token + '\n';
                        }
                      }
                    } catch (e) {
                      formatted = rawHtml;
                    }
                    
                    return (
                      <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap break-all">
                        {formatted.trim() || rawHtml}
                      </pre>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Product Page */}
        {activeTab === 'product' && (
          <div className="h-full w-full bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm relative min-h-[600px]">
             <div className="absolute top-0 left-0 right-0 bg-slate-100 p-2 border-b border-slate-200 flex items-center justify-between z-10">
                <div className="text-xs font-bold text-slate-500 px-2">Live Source Frame</div>
                <a href={job?.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline px-2">Open in Browser</a>
             </div>
             <iframe src={job?.url} title="Source Product" className="w-full h-full pt-10 border-0" />
          </div>
        )}

        {/* TAB 4: AI GENERATED PAGE (Mock Storefront) */}
        {activeTab === 'ai' && (
          <div className="h-full bg-white relative overflow-hidden flex flex-col">
            {(() => {
              let liveData = job?.product_data;
              try {
                liveData = JSON.parse(jsonData);
              } catch (e) {
                // If invalid JSON, fallback to last valid product_data
              }
              return (
                <ActiveFitnessPreview 
                  productData={liveData} 
                  onViewInImageReview={(group) => {
                    navigate(`/task-logs/ai-images/${jobId}?taskName=${encodeURIComponent(taskName)}&selectGroup=${group}`);
                  }}
                />
              );
            })()}
          </div>
        )}
      </div>

      {/* Fullscreen Overlay */}
      {isFullscreen && activeTab === 'ai' && createPortal(
        <div className="fixed inset-0 z-[9999] bg-white flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50 shadow-sm shrink-0">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Sparkles size={20} className="text-amber-500" />
              AI GENERATED PAGE PREVIEW
            </h2>
            <button 
              onClick={() => setIsFullscreen(false)}
              className="px-4 py-2 bg-slate-800 text-white rounded-md text-sm font-bold hover:bg-slate-700 transition-colors shadow-sm"
            >
              Exit Fullscreen
            </button>
          </div>
          <div className="flex-1 overflow-auto bg-white">
            {(() => {
              let liveData = job?.product_data;
              try {
                liveData = JSON.parse(jsonData);
              } catch (e) {}
              return (
                <ActiveFitnessPreview 
                  productData={liveData} 
                  onViewInImageReview={(group) => {
                    setIsFullscreen(false);
                    navigate(`/task-logs/ai-images/${jobId}?taskName=${encodeURIComponent(taskName)}&selectGroup=${group}`);
                  }}
                />
              );
            })()}
          </div>
        </div>,
        document.body
      )}
    </div>
    </div>
  );
}
