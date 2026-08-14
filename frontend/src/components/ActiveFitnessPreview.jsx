import React, { useState } from 'react';
import { Search, Image as ImageIcon } from 'lucide-react';
import clsx from 'clsx';
import api from '../api/client';

export default function ActiveFitnessPreview({ productData, onViewInImageReview }) {
  if (!productData) return <div className="p-8 text-center text-slate-400">No Product Data</div>;

  const identity = productData.product_identity || {};
  const images = productData.images || {};
  const pricing = productData.pricing || {};
  const features = productData.key_features || [];
  const about = productData.about_this_item || [];
  const specs = productData.specifications || {};
  const faqs = productData.faqs || [];
  
  const [activeTab, setActiveTab] = useState('specs');

  // Helper to construct usable image URL for UI
  const resolveImageUrl = (img) => {
    if (!img) return '';
    if (img.url && img.url.startsWith('http')) return img.url;
    const path = img.local_path || img.url;
    if (path) {
      return `${api.defaults.baseURL}/images/serve?path=${encodeURIComponent(path)}`;
    }
    return 'https://placehold.co/600x600/f1f5f9/94a3b8?text=No+Image';
  };

  const heroImage = resolveImageUrl(images.scraped_images?.[0]) || resolveImageUrl(images.lifestyle_images?.[0]) || 'https://placehold.co/600x600/f1f5f9/94a3b8?text=No+Image';
  const allImages = [...(images.scraped_images || []), ...(images.lifestyle_images || []), ...(images.feature_images || [])];
  
  const [activeIndex, setActiveIndex] = useState(0);
  
  const activeImageObj = allImages.length > 0 ? allImages[activeIndex] : null;
  const activeImage = activeImageObj ? resolveImageUrl(activeImageObj) : heroImage;
  const isAIGenerated = activeImageObj && activeImageObj.group;

  const handleNextImage = () => {
    if (allImages.length > 0) {
      setActiveIndex((prev) => (prev + 1) % allImages.length);
    }
  };

  const handlePrevImage = () => {
    if (allImages.length > 0) {
      setActiveIndex((prev) => (prev - 1 + allImages.length) % allImages.length);
    }
  };

  return (
    <div className="h-full overflow-y-auto font-sans bg-white text-[#1a1a1a]">
      {/* Top Header */}
      <header className="flex items-center justify-between px-8 py-3.5 border-b border-[#e2e2e2] gap-6 sticky top-0 bg-white z-50">
        <div className="flex items-center">
          <img src={`${import.meta.env.BASE_URL}afs-logo-main-en.png`} alt="Active Fitness Store" className="h-[42px] object-contain" />
        </div>
        <div className="hidden md:flex flex-1 max-w-[760px] items-center gap-2.5 bg-[#f7f7f7] border border-[#e2e2e2] rounded-md px-3.5 py-2.5 text-[#555555]">
          <Search size={16} />
          <input type="text" placeholder="Shop From 15000+ Products" className="border-none bg-transparent outline-none flex-1 text-[13px] text-[#1a1a1a]" disabled />
        </div>
        <div className="flex items-center gap-6 text-[12px] font-bold tracking-wide whitespace-nowrap text-[#1a1a1a]">
          <div className="hidden lg:flex items-center gap-1.5 cursor-pointer">📍 STORE LOCATIONS</div>
          <div className="flex items-center gap-1.5 cursor-pointer">🌐 EN ▾</div>
          <div className="flex items-center gap-1.5 cursor-pointer">👤 ▾</div>
          <div className="relative flex items-center cursor-pointer">
            🛒
            <span className="absolute -top-2 -right-2.5 bg-[#d5222a] text-white text-[9px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center">0</span>
          </div>
        </div>
      </header>

      {/* Main Nav */}
      <nav className="hidden md:flex items-center gap-8 px-8 py-3.5 border-b border-[#e2e2e2] text-[12.5px] font-extrabold tracking-wide">
        <div className="flex items-center gap-2 cursor-pointer">☰ SHOP BY CATEGORY</div>
        <div className="cursor-pointer hover:text-[#d5222a]">FITNESS</div>
        <div className="cursor-pointer hover:text-[#d5222a]">SPORTS</div>
        <div className="cursor-pointer hover:text-[#d5222a]">WELLNESS</div>
        <div className="cursor-pointer hover:text-[#d5222a]">PERFORMANCE</div>
        <div className="cursor-pointer hover:text-[#d5222a]">SALE</div>
        <div className="cursor-pointer hover:text-[#d5222a]">COMMERCIAL</div>
        <div className="ml-auto text-[#d5222a] flex items-center gap-2 cursor-pointer">
          <span className="w-5 h-5 rounded-full bg-[#d5222a] flex items-center justify-center text-white text-[9px]">▶</span> WHAT'S NEW
        </div>
      </nav>

      {/* Breadcrumb */}
      <div className="px-8 pt-4 pb-2 text-[12.5px] text-[#555555]">
        {productData.breadcrumbs?.map((crumb, idx) => (
          <React.Fragment key={idx}>
            <span className="hover:text-[#111111] hover:underline cursor-pointer">{crumb}</span>
            {idx < productData.breadcrumbs.length - 1 && <span className="mx-1.5">/</span>}
          </React.Fragment>
        )) || (
          <><span className="hover:text-[#111111] hover:underline cursor-pointer">Home</span> <span className="mx-1.5">/</span> <span className="hover:text-[#111111] hover:underline cursor-pointer">Fitness</span> <span className="mx-1.5">/</span> <span>{identity.product_name}</span></>
        )}
      </div>

      {/* Product Section */}
      <div className="grid grid-cols-1 lg:grid-cols-[100px_1fr_380px] gap-8 px-8 pt-5 items-start max-w-[1400px] mx-auto">
        
        {/* Thumbnails */}
        <div className="flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto lg:max-h-[600px] order-2 lg:order-1 scrollbar-hide pb-2 lg:pb-0 pr-1">
          {allImages.map((img, i) => (
            <img 
              key={i} 
              src={resolveImageUrl(img)} 
              alt="Thumbnail" 
              onClick={() => setActiveIndex(i)}
              className={clsx(
                "w-[84px] h-[84px] object-cover border rounded-md cursor-pointer shrink-0 transition-all",
                activeIndex === i ? "border-[#111111] border-2" : "border-[#e2e2e2] hover:border-[#8a8a8a]"
              )}
            />
          ))}
        </div>

        {/* Main Gallery */}
        <div className="flex flex-col items-center relative order-1 lg:order-2">
          <div className="relative w-full aspect-square bg-[#f7f7f7] rounded-md flex items-center justify-center overflow-hidden border border-[#e2e2e2] group">
            <img src={activeImage} alt="Main Product" className="w-full h-full object-contain mix-blend-multiply" />
            
            {isAIGenerated && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-20">
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    if (onViewInImageReview) onViewInImageReview(activeImageObj.group); 
                  }}
                  className="bg-white text-slate-900 px-4 py-2 rounded-md text-sm font-bold shadow-md hover:bg-slate-100 transition-colors flex items-center gap-2 pointer-events-auto"
                >
                  <ImageIcon size={16} />
                  View in Image Review
                </button>
              </div>
            )}

            <button onClick={handlePrevImage} className="absolute left-2.5 top-1/2 -translate-y-1/2 w-[34px] h-[34px] rounded-full bg-white border border-[#e2e2e2] flex items-center justify-center shadow-sm hover:bg-gray-50 text-[14px] z-30">‹</button>
            <button onClick={handleNextImage} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-[34px] h-[34px] rounded-full bg-white border border-[#e2e2e2] flex items-center justify-center shadow-sm hover:bg-gray-50 text-[14px] z-30">›</button>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5 mt-3.5 max-w-[80%] mx-auto">
            {allImages.map((img, i) => (
              <span key={i} onClick={() => setActiveIndex(i)} className={clsx("w-[34px] h-[3px] rounded-full cursor-pointer hover:bg-[#8a8a8a]", activeIndex === i ? "bg-[#111111]" : "bg-[#e2e2e2]")}></span>
            ))}
          </div>
        </div>

        {/* Buy Box */}
        <div className="order-3 pb-10">
          <h1 className="text-[26px] font-extrabold leading-tight mb-3.5 text-[#111111]">{identity.product_name}</h1>
          <div className="text-[24px] font-extrabold mb-3.5">AED {pricing.price || 'XXX.00'}</div>

          <div className="flex items-center gap-2.5 py-3 border-t border-[#e2e2e2] text-[12.5px] flex-wrap">
            <div className="flex gap-1.5">
              <span className="border border-[#e2e2e2] rounded px-1.5 py-0.5 text-[10px] font-extrabold bg-[#f7f7f7]">BANK</span>
              <span className="border border-[#e2e2e2] rounded px-1.5 py-0.5 text-[10px] font-extrabold bg-[#f7f7f7]">BANK</span>
            </div>
            Bank Offers 0% EMI — Pay AED {pricing.price ? (pricing.price / 6).toFixed(2) : '00.00'} for 6 months.
          </div>
          
          <div className="flex items-center gap-2.5 py-3 border-t border-[#e2e2e2] text-[12.5px] flex-wrap">
            <div className="flex gap-1.5">
              <span className="border border-[#e2e2e2] rounded px-1.5 py-0.5 text-[10px] font-extrabold bg-[#f7f7f7]">tamara</span>
              <span className="border border-[#e2e2e2] rounded px-1.5 py-0.5 text-[10px] font-extrabold bg-[#f7f7f7]">tabby</span>
            </div>
            Split into 3 interest-free payments of AED {pricing.price ? (pricing.price / 3).toFixed(2) : '00.00'}.
          </div>

          <div className="flex items-center gap-2.5 py-3 border-t border-[#e2e2e2] text-[13px]">
            <div className="flex items-center gap-1.5 font-extrabold text-[11px] border border-[#1a1a1a] rounded px-2 py-1">
              🚚 Standard
            </div>
            <span>Estimated delivery: <b>3-5 Business Days</b></span>
          </div>

          {identity.model && (
            <div className="mt-4">
              <div className="font-extrabold text-[13px] mb-2">Model</div>
              <div className="inline-block border border-[#1a1a1a] rounded px-4 py-2 text-[13px] font-semibold bg-white cursor-pointer">{identity.model}</div>
            </div>
          )}

          <div className="text-[#d5222a] font-bold text-[13px] mt-4">Hurry up! Only 2 left in stock</div>

          <div className="flex gap-3.5 mt-2.5">
            <button className="flex-1 py-4 bg-[#111111] text-white rounded text-[13px] font-extrabold tracking-wide hover:bg-[#333] transition-colors">ADD TO CART</button>
            <button className="flex-1 py-4 bg-[#d5222a] text-white rounded text-[13px] font-extrabold tracking-wide hover:bg-[#b81c23] transition-colors">BUY NOW</button>
          </div>

          <div className="flex gap-6 mt-4 text-[12.5px] font-bold text-[#1a1a1a]">
            <div className="flex items-center gap-1.5 cursor-pointer hover:text-[#d5222a]">♡ WISHLIST</div>
            <div className="flex items-center gap-1.5 cursor-pointer hover:text-[#d5222a]">⇄ COMPARE</div>
            <div className="flex items-center gap-1.5 cursor-pointer hover:text-[#d5222a]">⤴ SHARE</div>
          </div>

          <div className="mt-5.5 rounded-md overflow-hidden bg-gradient-to-r from-[#111] via-[#222] to-[#d5222a] text-white p-5 flex items-center justify-between gap-4 mt-6">
            <div>
              <h3 className="m-0 mb-1 text-[17px] font-bold leading-tight">Win Exciting Rewards on Every Order</h3>
              <p className="m-0 text-[12px] opacity-85 leading-tight">Above a qualifying spend threshold — seasonal sale partners</p>
            </div>
            <div className="bg-[#ffcc00] text-[#111] font-black text-[11px] rounded-full w-16 h-16 flex items-center justify-center text-center leading-[1.1] shrink-0">
              100%<br/>CASH<br/>BACK
            </div>
          </div>

          {about.length > 0 && (
            <div className="mt-6 pt-4 border-t border-[#e2e2e2]">
              <h4 className="text-[13px] tracking-wide mb-2 font-bold">ABOUT THIS ITEM</h4>
              <ul className="list-disc pl-4 text-[13px] text-[#555555] mb-2 space-y-1">
                {about.slice(0, 3).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
              <a href="#specs-tab" className="text-[#111111] underline text-[13px] font-semibold hover:text-[#d5222a]" onClick={(e) => { e.preventDefault(); setActiveTab('specs'); }}>Learn more</a>
            </div>
          )}

          <div className="flex items-center gap-4 py-4 border-t border-[#e2e2e2] mt-2">
            <div className="w-[46px] h-[46px] border border-[#e2e2e2] rounded flex items-center justify-center font-black text-[11px] bg-[#f7f7f7]">{identity.brand || 'LOGO'}</div>
            <div>
              <div className="text-[12.5px] text-[#555555]">BRAND: <b className="text-[#1a1a1a] text-[13px] block mt-0.5">{identity.brand}</b></div>
              <a href="#" className="text-[12.5px] text-[#111111] underline font-semibold mt-0.5 block hover:text-[#d5222a]">Visit Brand Store</a>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-2">
            <button className="bg-[#f2f2f2] border-none rounded p-3.5 text-[12.5px] font-bold flex items-center justify-center gap-2 hover:bg-[#e2e2e2]">📄 REQUEST PRICE MATCH</button>
            <button className="bg-[#f2f2f2] border-none rounded p-3.5 text-[12.5px] font-bold flex items-center justify-center gap-2 hover:bg-[#e2e2e2]">🔔 SET PRICE DROP ALERT</button>
            <button className="bg-[#f2f2f2] border-none rounded p-3.5 text-[12.5px] font-bold flex items-center justify-center gap-2 col-span-2 hover:bg-[#e2e2e2]">💬 CHAT WITH AN EXPERT</button>
          </div>
        </div>
      </div>

      {/* Tabs Section */}
      <div className="mt-6 px-8 pb-16 max-w-[1400px] mx-auto" id="specs-tab">
        <div className="flex gap-8 border-b border-[#e2e2e2]">
          <div onClick={() => setActiveTab('specs')} className={clsx("py-4 font-extrabold text-[13px] tracking-wide cursor-pointer border-b-2", activeTab === 'specs' ? "text-[#d5222a] border-[#d5222a]" : "text-[#555555] border-transparent hover:text-[#1a1a1a]")}>SPECIFICATIONS</div>
          <div onClick={() => setActiveTab('features')} className={clsx("py-4 font-extrabold text-[13px] tracking-wide cursor-pointer border-b-2", activeTab === 'features' ? "text-[#d5222a] border-[#d5222a]" : "text-[#555555] border-transparent hover:text-[#1a1a1a]")}>FEATURES</div>
          <div onClick={() => setActiveTab('faq')} className={clsx("py-4 font-extrabold text-[13px] tracking-wide cursor-pointer border-b-2", activeTab === 'faq' ? "text-[#d5222a] border-[#d5222a]" : "text-[#555555] border-transparent hover:text-[#1a1a1a]")}>FAQS</div>
          <div onClick={() => setActiveTab('policy')} className={clsx("py-4 font-extrabold text-[13px] tracking-wide cursor-pointer border-b-2", activeTab === 'policy' ? "text-[#d5222a] border-[#d5222a]" : "text-[#555555] border-transparent hover:text-[#1a1a1a]")}>SALES POLICY</div>
        </div>

        <div className="max-w-[900px] pt-8">
          {activeTab === 'specs' && (
            <div>
              <h2 className="text-[22px] font-bold tracking-wide mb-4">SPECIFICATIONS</h2>
              <table className="w-full border-collapse mb-8">
                <tbody>
                  {productData.features_table ? (
                    productData.features_table.map((row, i) => (
                      <tr key={i} className="border-b border-[#e2e2e2] hover:bg-[#f7f7f7]">
                        <td className="py-3.5 text-[13px] text-[#555555] w-[45%] pr-4 capitalize">{row.label}</td>
                        <td className="py-3.5 text-[13px] font-semibold text-[#1a1a1a]">{row.value}</td>
                      </tr>
                    ))
                  ) : (
                    Object.entries(specs).map(([key, val]) => {
                      if (typeof val === 'object' || !val) return null;
                      return (
                        <tr key={key} className="border-b border-[#e2e2e2] hover:bg-[#f7f7f7]">
                          <td className="py-3.5 text-[13px] text-[#555555] w-[45%] pr-4 capitalize">{key.replace(/_/g, ' ')}</td>
                          <td className="py-3.5 text-[13px] font-semibold text-[#1a1a1a]">{val}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
              {productData.long_description && (
                 <>
                   <h2 className="text-[22px] font-bold tracking-wide mb-4 mt-8">DESCRIPTION</h2>
                   <p className="text-[13.5px] text-[#1a1a1a] leading-[1.7] whitespace-pre-wrap">{productData.long_description}</p>
                 </>
              )}
            </div>
          )}

          {activeTab === 'features' && (
            <div>
              <h2 className="text-[22px] font-bold tracking-wide mb-6">KEY FEATURES</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {features.map((feat, idx) => {
                  const featImg = images.feature_images?.[idx];
                  return (
                    <div key={idx} className="bg-[#f7f7f7] rounded-lg overflow-hidden border border-[#e2e2e2]">
                      {featImg && (
                         <img src={resolveImageUrl(featImg)} alt={feat.title} className="w-full h-48 object-cover mix-blend-multiply bg-white" />
                      )}
                      <div className="p-5">
                        <h3 className="font-bold text-[16px] mb-2">{feat.title}</h3>
                        <p className="text-[13.5px] text-[#555555] leading-relaxed">{feat.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'faq' && (
            <div>
              <h2 className="text-[22px] font-bold tracking-wide mb-6">FREQUENTLY ASKED QUESTIONS</h2>
              {faqs.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {faqs.map((faq, i) => (
                    <details key={i} className="border border-[#e2e2e2] rounded-md group bg-white shadow-sm overflow-hidden open:bg-[#f7f7f7]">
                      <summary className="p-4 font-bold cursor-pointer list-none flex justify-between items-center text-[14px] outline-none select-none hover:bg-[#f7f7f7]">
                        {faq.question}
                        <span className="text-[#d5222a] text-xl font-light group-open:rotate-45 transition-transform duration-300 ml-4 shrink-0">+</span>
                      </summary>
                      <div className="p-4 pt-0 text-[#555555] text-[13.5px] leading-relaxed border-t border-transparent group-open:border-[#e2e2e2] mt-2">
                        {faq.answer}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-[13.5px] text-[#555555]">No FAQs available for this product.</p>
              )}
            </div>
          )}

          {activeTab === 'policy' && (
            <div>
              <h2 className="text-[22px] font-bold tracking-wide mb-4">SALES POLICY</h2>
              <p className="text-[13.5px] text-[#1a1a1a] leading-[1.7]">
                Everything you need to know before and after your purchase — Delivery, Warranty, Returns &amp; Refunds, Cash on Delivery and Installation Details.<br/><br/>
                <a href="#" className="font-bold underline hover:text-[#d5222a]">Read our full policies</a>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
