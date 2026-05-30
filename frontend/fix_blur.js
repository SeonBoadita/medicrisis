const fs = require('fs');
const path = require('path');

const teamPath = 'c:/xampp_new/htdocs/medicrisis/frontend/team.html';
let content = fs.readFileSync(teamPath, 'utf8');

// The class string we want to replace
// original: cursor-none z-10 hover:z-20 hover:border-white/60
// new: cursor-none z-10 group-hover/skills:blur-[2px] hover:!blur-none hover:z-20 hover:border-white/60
const replacedContent = content.replace(/cursor-none z-10 hover:z-20/g, 'cursor-none z-10 group-hover/skills:blur-[2px] hover:!blur-none hover:z-20');

if (content !== replacedContent) {
    fs.writeFileSync(teamPath, replacedContent);
    console.log('Fixed hover blur in team.html');
} else {
    console.log('No changes made to team.html, pattern not found.');
}
