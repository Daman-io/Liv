const BLOCKED_CHANNEL = "T-Series";

function vaporizeTSeries() {
  // 1. STANDARD GRID CLEANUP (Home feed, Search results, channel pages)
  const links = document.querySelectorAll(`
    #text.ytd-channel-name, 
    a[href*="/@tseries"], 
    #channel-title,
    a[href*="user/tseries"],
    a[aria-label*="T-Series"]
  `);

  links.forEach(link => {
    if (
      link.textContent.trim() === BLOCKED_CHANNEL || 
      link.href?.toLowerCase().includes('/@tseries') ||
      link.href?.toLowerCase().includes('user/tseries') ||
      link.getAttribute('aria-label')?.includes(BLOCKED_CHANNEL)
    ) {
      const card = link.closest(`
        ytd-rich-item-renderer, 
        ytd-video-renderer, 
        ytd-compact-video-renderer,
        ytd-channel-renderer,
        ytd-reel-item-renderer,
        ytd-post-renderer,
        yt-lockup-view-model
      `);
      if (card) card.remove();
    }
  });

  // 2. EXTRA HEAVY SHELF WIPER (Catches custom rows/shelves)
  const sections = document.querySelectorAll(`
    ytd-shelf-renderer, 
    ytd-reel-shelf-renderer, 
    ytd-rich-section-renderer,
    grid-shelf-view-model,
    yt-horizontal-list-renderer
  `);

  sections.forEach(section => {
    if (section.textContent.includes(BLOCKED_CHANNEL)) {
      section.remove();
    }
  });

  // 3. FULL-SCREEN SHORTS AUTO-SKIPPER (Catches them while scrolling the Shorts tab)
  // Find all active video windows in the Shorts feed loop
  const activeShorts = document.querySelectorAll('ytd-reel-video-renderer');
  
  activeShorts.forEach(short => {
    // Check if this specific active short belongs to the channel
    const channelText = short.querySelector('.ytd-channel-name, [aria-label*="T-Series"], a[href*="/@tseries"]');
    
    if (channelText && (channelText.textContent.includes(BLOCKED_CHANNEL) || channelText.getAttribute('aria-label')?.includes(BLOCKED_CHANNEL))) {
      
      // Pause the video immediately so you don't hear the music audio
      const videoElement = short.querySelector('video');
      if (videoElement) {
        videoElement.pause();
      }

      // Find YouTube's native "Next Video" navigation button on the side navigation console
      const nextButton = document.querySelector('#navigation-button-down button, ytd-shorts-player-controls #next-button button, .yt-spec-button-shape-next');
      
      if (nextButton) {
        console.log("T-Series Short detected! Auto-skipping...");
        nextButton.click(); // Programmatically smash the next button
      }
    }
  });
}

// 4. Background Scanner: Instantly intercepts infinite scroll additions and swipe movements
const observer = new MutationObserver(() => {
  vaporizeTSeries();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Fire instantly on initial load
vaporizeTSeries();