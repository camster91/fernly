// Root: just the RootNav. The original App.tsx gets replaced by this single line.
import { StatusBar } from 'expo-status-bar';
import { RootNav } from './src/nav/RootNav';

export default function App() {
  return (
    <>
      <StatusBar style="dark" />
      <RootNav />
    </>
  );
}