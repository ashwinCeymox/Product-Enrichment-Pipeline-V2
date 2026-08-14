import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { Search, Loader2, Image as ImageIcon, FileText, RefreshCw, Clock, CheckCircle2, XCircle, AlertCircle, RefreshCcw, Trash2, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';

export default function TaskLogs() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTasks, setExpandedTasks] = useState(new Set());
  const [jobToAbort, setJobToAbort] = useState(null);
  const [isAborting, setIsAborting] = useState(false);
  const [reschedulingJob, setReschedulingJob] = useState(null);
  
  // Reschedule Modal States
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleTask, setRescheduleTask] = useState(null);
  const [rescheduleType, setRescheduleType] = useState('now');
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleLoading, setRescheduleLoading] = useState(false);

  const navigate = useNavigate();

  const fetchTasks = async () => {
    try {
      // Fetching individual jobs and grouping them by task_name
      // Filter out completed and success tasks so they disappear from the active logs list
      const res = await api.get('/dashboard/recent-activity?limit=100');
      const jobs = (res.data.items || []).filter(job => !['completed', 'success'].includes(job.status));
      
      const grouped = {};
      jobs.forEach(job => {
        if (!grouped[job.task_name]) {
          grouped[job.task_name] = {
            task_name: job.task_name,
            jobs: [],
            status: 'processing' // Will be computed after
          };
        }
        grouped[job.task_name].jobs.push(job);
      });
      
      // Compute accurate group status
      Object.values(grouped).forEach(group => {
        const statuses = group.jobs.map(j => j.status);
        const hasError = statuses.some(s => ['failed', 'aborted', 'error', 'rescheduled'].includes(s));
        const hasPending = statuses.some(s => ['pending', 'queued', 'processing', 'scraping', 'ai_processing', 'image_generation'].includes(s));
        
        if (hasError) {
          group.status = 'error';
        } else if (hasPending) {
          group.status = 'processing';
        } else {
          group.status = 'completed';
        }
      });
      
      const taskList = Object.values(grouped).sort((a, b) => {
        const latestA = Math.max(...a.jobs.map(j => new Date(j.created_at || 0).getTime()));
        const latestB = Math.max(...b.jobs.map(j => new Date(j.created_at || 0).getTime()));
        return latestB - latestA;
      });
      
      setTasks(taskList);
      
      // Auto-expand the first task if nothing is expanded yet
      setExpandedTasks(prev => {
        if (taskList.length > 0 && prev.size === 0) {
          return new Set([taskList[0].task_name]);
        }
        return prev;
      });
    } catch (err) {
      console.error('Failed to fetch task logs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && jobToAbort && !isAborting) {
        setJobToAbort(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jobToAbort, isAborting]);

  const toggleTask = (taskName) => {
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(taskName)) {
      newExpanded.delete(taskName);
    } else {
      newExpanded.add(taskName);
    }
    setExpandedTasks(newExpanded);
  };

  const handleAbortConfirm = async () => {
    if (!jobToAbort) return;
    setIsAborting(true);
    try {
      await api.delete(`/jobs/${jobToAbort}`);
      setJobToAbort(null);
      fetchTasks();
    } catch (err) {
      alert("Failed to abort task.");
    } finally {
      setIsAborting(false);
    }
  };

  const handleOpenReschedule = (job) => {
    setRescheduleTask(job);
    setRescheduleType('now');
    setRescheduleDate('');
    setShowRescheduleModal(true);
  };

  const handleRescheduleSubmit = async () => {
    if (!rescheduleTask) return;
    if (rescheduleType === 'later' && !rescheduleDate) {
      alert("Please select a date to schedule.");
      return;
    }
    
    setRescheduleLoading(true);
    setReschedulingJob(rescheduleTask.job_id); // update button loading state too
    try {
      await api.post(`/jobs/${rescheduleTask.job_id}/reschedule`, {
        scheduled_date: rescheduleType === 'later' ? rescheduleDate : null
      });
      fetchTasks();
      setShowRescheduleModal(false);
      setRescheduleTask(null);
    } catch (error) {
      alert("Failed to reschedule job.");
    } finally {
      setRescheduleLoading(false);
      setReschedulingJob(null);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success': 
      case 'waiting_for_approval': return <CheckCircle2 size={16} className="text-emerald-500" />;
      case 'failed':
      case 'aborted':
      case 'error': return <XCircle size={16} className="text-rose-500" />;
      case 'rescheduled': return <AlertCircle size={16} className="text-amber-500" />;
      default: return <Loader2 size={16} className="text-indigo-500 animate-spin" />;
    }
  };

  const getStatusLabel = (status) => {
    switch(status) {
      case 'pending':
      case 'queued': return 'Queued';
      case 'processing':
      case 'scraping': return 'Scraping';
      case 'ai_processing': return 'Ai Processing';
      case 'image_generation': return 'Image Generation';
      case 'waiting_for_approval': return 'Pending Review';
      case 'success': return 'Success';
      case 'failed': return 'Failed';
      case 'error': return 'Error';
      case 'rescheduled': return 'Rescheduled';
      default: return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Processing';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    // Format to match screenshot: MM/DD/YYYY
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const filteredTasks = tasks.filter(t => t.task_name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Task Logs</h1>
          <p className="text-sm text-slate-500 mt-1">Pipeline execution records for product enrichment.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search tasks..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-300 rounded-md text-sm focus:ring-primary focus:border-primary w-64 bg-white"
            />
          </div>
          <button onClick={fetchTasks} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors">
            Refresh Logs
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 size={32} className="animate-spin text-primary" />
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
          <AlertCircle size={48} className="mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-semibold text-slate-800">No tasks found</h3>
          <p className="text-slate-500">Try adjusting your search.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTasks.map((task) => {
            const isExpanded = expandedTasks.has(task.task_name);
            return (
              <div key={task.task_name} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden transition-all">
                {/* Task Header */}
                <div 
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => toggleTask(task.task_name)}
                >
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-slate-800">{task.task_name}</h3>
                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-md">
                      {task.jobs.length} Links
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className={clsx("flex items-center gap-1.5 text-sm font-medium bg-white px-2 py-1", 
                      task.status === 'completed' ? "text-emerald-600" :
                      task.status === 'error' ? "text-rose-600" : "text-indigo-600"
                    )}>
                      <div className={clsx("w-2 h-2 rounded-full",
                        task.status === 'completed' ? "bg-emerald-600" :
                        task.status === 'error' ? "bg-rose-600" : "bg-indigo-600 animate-pulse"
                      )}></div>
                      {(() => {
                        const hasRefError = task.jobs.some(j => j.error_message && j.error_message.includes('No reference image found'));
                        if (hasRefError) return 'No reference image found';
                        return getStatusLabel(task.status);
                      })()}
                    </div>
                    <svg
                      className={clsx("w-5 h-5 text-slate-400 transition-transform", isExpanded && "rotate-180")}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Job List */}
                {isExpanded && (
                  <div className="p-4 pt-0 border-t border-slate-100 bg-slate-50/50 space-y-3 mt-3">
                    {task.jobs.map((job) => {
                      const isComplete = ['success', 'completed', 'waiting_for_approval', 'image_generation_complete'].includes(job.status);
                      const showReviewButtons = isComplete || job.status === 'image_generation';
                      const isFailed = ['failed', 'aborted', 'error', 'rescheduled'].includes(job.status);
                      const inProgress = !isComplete && !isFailed;
                      const progress = isComplete ? 100 : (job.progress || (job.status === 'ai_processing' ? 60 : 30));

                      return (
                        <div 
                          key={job.job_id} 
                          className="flex flex-col p-4 rounded-xl border border-slate-200 bg-white shadow-sm transition-all"
                        >
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-bold text-slate-800 text-lg truncate pr-4">
                              {job.source_url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]} 
                              {/* Simple domain extraction as a fallback task name if job has no explicit name */}
                            </h4>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 text-slate-500 text-xs font-semibold rounded-md border border-slate-100">
                                <Clock size={12}/> {formatDate(job.created_at)}
                              </span>
                              {getStatusIcon(job.status)}
                            </div>
                          </div>
                          
                          <a 
                            href={job.source_url} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="text-sm text-slate-500 hover:text-indigo-600 hover:underline truncate block mb-4"
                          >
                            {job.source_url}
                          </a>

                          <div className="flex justify-between items-center mt-auto pt-2">
                            <div className="flex items-center gap-3">
                              <span className="border border-slate-200 px-3 py-1 rounded-full text-sm font-medium text-slate-600 bg-white">
                                {job.error_message && job.error_message.includes('No reference image found') ? 'No reference image found' : getStatusLabel(job.status)}
                              </span>
                              
                              {/* Review Buttons - Only show when waiting_for_approval, success, or generating images */}
                              {showReviewButtons && (
                                <div className="flex items-center gap-2 ml-2">
                                  {job.generate_ai_images ? (
                                    <>
                                      <button 
                                        onClick={() => navigate(`/task-logs/content-preview/${job.job_id}?taskName=${encodeURIComponent(task.task_name)}&tab=table`)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00A389]/10 text-[#00A389] border border-[#00A389]/30 rounded-md text-xs font-bold hover:bg-[#00A389]/20 transition-colors"
                                      >
                                        <FileText size={14} /> CONTENT PREVIEW
                                      </button>
                                      <button 
                                        onClick={() => navigate(`/task-logs/ai-images/${job.job_id}?taskName=${encodeURIComponent(task.task_name)}`)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-xs font-bold hover:bg-indigo-100 transition-colors"
                                      >
                                        <ImageIcon size={14} /> IMAGE REVIEW
                                      </button>
                                    </>
                                  ) : (
                                    <button 
                                      onClick={() => navigate(`/task-logs/content-preview/${job.job_id}?taskName=${encodeURIComponent(task.task_name)}`)}
                                      className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-bold hover:bg-indigo-700 transition-colors shadow-sm"
                                    >
                                      PROCEED
                                    </button>
                                  )}
                                </div>
                              )}
                              
                              {isFailed && (
                                <button 
                                  onClick={() => handleOpenReschedule(job)}
                                  disabled={reschedulingJob === job.job_id}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                                >
                                  {reschedulingJob === job.job_id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} 
                                  {reschedulingJob === job.job_id ? 'RESCHEDULING...' : 'RESCHEDULE'}
                                </button>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-2">
                              {job.status !== 'aborted' && (
                                <button 
                                  onClick={() => setJobToAbort(job.job_id)}
                                  className="flex items-center justify-center w-8 h-8 rounded-[10px] border-2 border-rose-200 bg-white text-rose-600 hover:bg-rose-50 hover:border-rose-300 transition-all shadow-sm" 
                                  title="Abort Job"
                                >
                                  <Trash2 size={15} strokeWidth={2.5} />
                                </button>
                              )}
                              <span className="text-indigo-600 font-bold tracking-tight">
                                {progress}%
                              </span>
                            </div>
                          </div>
                          
                          {/* Error message row if failed */}
                          {isFailed && job.error_message && (
                            <div className="mt-3 text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-100">
                              {job.error_message}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Abort Confirmation Modal */}
      {jobToAbort && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 border border-slate-200">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Abort this task?</h3>
            <p className="text-sm text-slate-500 mb-6">
              Are you sure you want to abort this task? The task will be removed from the active processing pipeline.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setJobToAbort(null)}
                disabled={isAborting}
                className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                CANCEL
              </button>
              <button 
                onClick={handleAbortConfirm}
                disabled={isAborting}
                className="px-4 py-2 text-sm font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                {isAborting && <Loader2 size={14} className="animate-spin" />}
                ABORT TASK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {showRescheduleModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex flex-col items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4">
                <RefreshCcw size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-800">Reschedule Task</h3>
              <p className="text-sm text-slate-500 mt-2 truncate w-full max-w-sm">
                {rescheduleTask?.task_name}
              </p>
            </div>
            
            <div className="p-6">
              <div className="flex flex-col gap-4">
                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                  <input 
                    type="radio" 
                    name="rescheduleType" 
                    value="now" 
                    checked={rescheduleType === 'now'} 
                    onChange={() => setRescheduleType('now')} 
                    className="w-4 h-4 text-blue-600 focus:ring-blue-600"
                  />
                  <div className="flex flex-col">
                    <span className="font-semibold text-sm text-slate-800">Schedule Now</span>
                    <span className="text-xs text-slate-500">Send immediately to the scraping queue</span>
                  </div>
                </label>
                
                <label className="flex flex-col gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <input 
                      type="radio" 
                      name="rescheduleType" 
                      value="later" 
                      checked={rescheduleType === 'later'} 
                      onChange={() => setRescheduleType('later')} 
                      className="w-4 h-4 text-blue-600 focus:ring-blue-600"
                    />
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm text-slate-800">Schedule Later</span>
                      <span className="text-xs text-slate-500">Choose a future date to run this task</span>
                    </div>
                  </div>
                  
                  {rescheduleType === 'later' && (
                    <div className="pl-7 pr-2 pt-2">
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Calendar size={16} className="text-slate-400" />
                        </div>
                        <input 
                          type="date" 
                          value={rescheduleDate}
                          onChange={e => setRescheduleDate(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          className="w-full pl-10 px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-slate-700 outline-none"
                        />
                      </div>
                    </div>
                  )}
                </label>
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 flex justify-end gap-3 border-t border-slate-100">
              <button 
                onClick={() => { setShowRescheduleModal(false); setRescheduleTask(null); }}
                disabled={rescheduleLoading}
                className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleRescheduleSubmit}
                disabled={rescheduleLoading || (rescheduleType === 'later' && !rescheduleDate)}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {rescheduleLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Processing...
                  </>
                ) : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
