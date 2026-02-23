import simpleGit, { SimpleGit } from 'simple-git';

// Initialize simple-git in the current directory
const git: SimpleGit = simpleGit();

async function checkGitDiff() {
  try {
    //Displays the difference between the current version and the old version
    const diff = await git.diff();
    console.log('Git diff:', diff);
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

async function gitAdd(remoteName: string, dirName: string) {
  try {
    //Accesses the git add -p command at a given directory
    const add = await git.addRemote(remoteName, dirName);
    console.log('Git diff:', add);
  } catch (error) {
    console.error('An error occurred:', error);
  }
}