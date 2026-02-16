import axios from 'axios';

const GITHUB_API_URL = 'https://api.github.com';

export const getUserProfile = async (username: string) => {
  const response = await axios.get(`${GITHUB_API_URL}/users/${username}`);
  return response.data;
};

export const getUserRepositories = async (username: string) => {
  const response = await axios.get(`${GITHUB_API_URL}/users/${username}/repos`);
  return response.data;
};