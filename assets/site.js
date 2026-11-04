/* Shared by every page of the lab. Holds the site's sections, in one place, and draws the top menu.

   A page declares its menu as an empty element and says where it sits and what it is:
     <nav class="top" data-root="../" data-current="library"></nav>
   data-root    path from this page back to the site root
   data-current which section to highlight (a key from LAB.SECTIONS); leave it off on the home page

   To add a section or rename one, change LAB.SECTIONS: the menu on every page and the home page guide both read it. */
const LAB = {
  SECTIONS: [
    {key:"repos",    name:"Repos",    path:"repos/",    what:"The open projects I've forked to study, grouped by theme. Each one credits its creator and links to the original."},
    {key:"library",  name:"Library",  path:"library/",  what:"The articles, reports, papers, tools and datasets I'm learning from, searchable and shelved by type."},
    {key:"tasks",    name:"Tasks",    path:"tasks/",    what:"What I'm working on now and what's finished, read live from my task tracker on GitHub."},
    {key:"training", name:"Training", path:"training/", what:"Hands-on SQL, Python and R sessions on World Cup data. They run in your browser and check your answers."},
    {key:"credits",  name:"Credits",  path:"credits/",  what:"Everyone whose work appears in the lab, with where you'll find it."}
  ]
};

// A 4-3-3 as [across the pitch, up the pitch] from 0 to 1, used by the page illustrations
const F433 = [[.06,.5],[.22,.15],[.2,.38],[.2,.62],[.22,.85],[.44,.27],[.4,.5],[.44,.73],[.68,.18],[.72,.5],[.68,.82]];

/* ---------- top menu ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const nav = document.querySelector("nav.top[data-root]");
  if(!nav) return;
  const root = nav.dataset.root;
  nav.innerHTML = `<div class="wrap"><a class="brand" href="${root || "./"}"><i aria-hidden="true"></i>Football Analytics Lab</a><span class="sp"></span>` +
    LAB.SECTIONS.map(s => `<a class="lnk" href="${root}${s.path}"${s.key === nav.dataset.current ? ' aria-current="page"' : ""}>${s.name}</a>`).join("") + `</div>`;
});
