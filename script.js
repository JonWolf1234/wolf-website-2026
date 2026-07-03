const siteHeader=document.querySelector('.site-header');
let headerTick=false;
function updateHeader(){
  const y=Math.max(0,window.scrollY);
  const offset=Math.max(0,30-Math.min(y,30));
  siteHeader.style.setProperty('--header-offset',`${offset}px`);
  siteHeader.classList.toggle('is-scrolled',y>34);
  headerTick=false;
}
window.addEventListener('scroll',()=>{if(!headerTick){requestAnimationFrame(updateHeader);headerTick=true}},{passive:true});
updateHeader();

const menuButton=document.querySelector('.menu-toggle');
const nav=document.querySelector('.site-nav');
menuButton.addEventListener('click',()=>{const open=nav.classList.toggle('is-open');menuButton.setAttribute('aria-expanded',open)});
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('is-open');menuButton.setAttribute('aria-expanded','false')}));

const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');observer.unobserve(e.target)}}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));

const filters=document.querySelectorAll('.filter');
const cards=document.querySelectorAll('.project-card');
filters.forEach(btn=>btn.addEventListener('click',()=>{filters.forEach(b=>b.classList.remove('is-active'));btn.classList.add('is-active');const f=btn.dataset.filter;cards.forEach(card=>card.hidden=f!=='all'&&card.dataset.category!==f)}));

const modal=document.querySelector('.project-modal');
const modalImage=document.querySelector('#modal-image');
const modalTitle=document.querySelector('#modal-title');
const modalText=document.querySelector('#modal-text');
function openProject(card){modalImage.src=card.dataset.image;modalImage.alt=card.querySelector('img').alt;modalTitle.textContent=card.dataset.title;modalText.textContent=card.dataset.copy;modal.showModal()}
cards.forEach(card=>{card.addEventListener('click',()=>openProject(card));card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openProject(card)}})});
document.querySelector('.modal-close').addEventListener('click',()=>modal.close());
modal.addEventListener('click',e=>{const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close()});

/* =========================================================
   WHO WE WORK WITH — HORIZONTAL ACCORDION
   ========================================================= */

document.querySelectorAll("[data-sector-accordion]").forEach((accordion) => {
  const panels = Array.from(
    accordion.querySelectorAll("[data-sector-panel]")
  );

  function activatePanel(selectedPanel) {
    panels.forEach((panel) => {
      const button = panel.querySelector(".sector-panel__button");
      const isSelected = panel === selectedPanel;

      panel.classList.toggle("is-active", isSelected);
      button.setAttribute("aria-expanded", String(isSelected));
    });
  }

  panels.forEach((panel, index) => {
    const button = panel.querySelector(".sector-panel__button");

    button.addEventListener("click", () => {
      activatePanel(panel);
    });

    button.addEventListener("keydown", (event) => {
      let nextIndex = null;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (index + 1) % panels.length;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (index - 1 + panels.length) % panels.length;
      }

      if (event.key === "Home") {
        nextIndex = 0;
      }

      if (event.key === "End") {
        nextIndex = panels.length - 1;
      }

      if (nextIndex !== null) {
        event.preventDefault();

        const nextPanel = panels[nextIndex];
        const nextButton = nextPanel.querySelector(
          ".sector-panel__button"
        );

        activatePanel(nextPanel);
        nextButton.focus();
      }
    });
  });
});