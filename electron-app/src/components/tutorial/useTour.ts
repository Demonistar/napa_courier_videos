import { useState } from 'react';
import { TourStep } from './TourOverlay';

export const tourSteps: TourStep[] = [
  {
    target: 'location-tree',
    title: 'Location Tree',
    description:
      'This is the Location Tree. Browse delivery locations organized by state and city. Click any site to view its details.',
  },
  {
    target: 'detail-panel',
    title: 'Detail Panel',
    description:
      'This panel shows full details for the selected location including address, images, video links, delivery instructions, and modification history.',
  },
  {
    target: 'action-bar',
    title: 'Action Controls',
    description:
      'Use these buttons to add new locations, modify existing ones, or delete locations. Forms appear inline when you click Add or Modify.',
  },
  {
    target: 'input-search',
    title: 'Global Search',
    description:
      'Use search to find any location instantly by site name, city, state, or address. The tree filters automatically as you type.',
  },
  {
    target: 'button-publish',
    title: 'Publish Changes',
    description:
      'Changes are saved to a staging layer. When you\'re ready, click "Publish to Live" to push all changes live for drivers to see.',
  },
];

export function useTour() {
  const [isTourActive, setIsTourActive] = useState(false);

  const startTour = () => setIsTourActive(true);
  const endTour = () => setIsTourActive(false);

  return {
    isTourActive,
    startTour,
    endTour,
  };
}
