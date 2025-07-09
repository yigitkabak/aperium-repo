<!-- scripts/css.svelte -->
<style>
  /* globals.css */
  :global(body) {
    background-color: #0a0a0a;
    background-image: 
      linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
    background-size: 20px 20px;
    margin: 0;
    min-height: 100vh;
    font-family: ui-monospace, Cascadia Code, Source Code Pro, monospace;
    -ms-overflow-style: none;
    scrollbar-width: none;
    overflow: hidden;
  }

  :global(body::-webkit-scrollbar) {
    display: none;
  }

  :global(.container) {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: calc(100vh - 3rem);
    padding: 2rem;
    color: #fff;
    gap: 3rem;
  }

  :global(.header) {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  :global(.logo) {
    width: 64px;
    height: 64px;
    filter: brightness(0) invert(1);
  }

  :global(h1) {
    font-size: 3.5rem;
    margin: 0;
    font-weight: 600;
    letter-spacing: -.03em;
  }

  :global(.subheader) {
    font-size: 1.15rem;
    opacity: .9;
    max-width: 32rem;
    text-align: center;
    line-height: 1.6;
  }
  
  :global(.subheader a) {
    color: #fff;
    text-decoration: none;
  }
  
  :global(.subheader a:hover) {
    opacity: 0.8;
  }

  :global(.subheader p) {
    margin: 0;
  }

  :global(nav) {
    display: flex;
    gap: 2.5rem;
  }

  :global(.nav-link) {
    color: #fff;
    text-decoration: none;
    font-size: 1.1rem;
    opacity: .8;
    transition: opacity .2s ease;
  }

  :global(.nav-link:hover) {
    opacity: 1;
    text-decoration: underline;
  }

  :global(footer) {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    text-align: center;
    font-size: .9rem;
    color: #767676;
    background-color: #111;
    padding: .75rem;
    border-top: 1px solid #222222;
  }

  :global(footer p) {
    margin: 0;
  }
</style>