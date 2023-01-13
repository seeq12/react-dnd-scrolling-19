import React, { useEffect, useRef, useContext } from 'react';
import PropTypes from 'prop-types';
import defaults from 'defaults';
import { DndContext } from 'react-dnd';
import throttle from 'lodash.throttle';
import raf from 'raf';
import hoist from 'hoist-non-react-statics';
import { noop, intBetween, getCoords } from './util.js';

const DEFAULT_BUFFER = 150;

const getDisplayName = PassedComponent =>
  PassedComponent.displayName ||
  PassedComponent.name ||
  (typeof PassedComponent === 'string' && PassedComponent.length > 0
    ? PassedComponent
    : 'Unknown');

export function createHorizontalStrength(_buffer) {
  return function defaultHorizontalStrength({ x, w, y, h }, point) {
    const buffer = Math.min(w / 2, _buffer);
    const inRange = point.x >= x && point.x <= x + w;
    const inBox = inRange && point.y >= y && point.y <= y + h;

    if (inBox) {
      if (point.x < x + buffer) {
        return (point.x - x - buffer) / buffer;
      } else if (point.x > x + w - buffer) {
        return -(x + w - point.x - buffer) / buffer;
      }
    }

    return 0;
  };
}

export function createVerticalStrength(_buffer) {
  return function defaultVerticalStrength({ y, h, x, w }, point) {
    const buffer = Math.min(h / 2, _buffer);
    const inRange = point.y >= y && point.y <= y + h;
    const inBox = inRange && point.x >= x && point.x <= x + w;

    if (inBox) {
      if (point.y < y + buffer) {
        return (point.y - y - buffer) / buffer;
      } else if (point.y > y + h - buffer) {
        return -(y + h - point.y - buffer) / buffer;
      }
    }

    return 0;
  };
}

export const defaultHorizontalStrength = createHorizontalStrength(DEFAULT_BUFFER);

export const defaultVerticalStrength = createVerticalStrength(DEFAULT_BUFFER);

class ScrollingMonitor {
  constructor(dragDropManager, container, options) {
    this.dragDropManager = dragDropManager;
    this.container = container;
    this.options = options;

    this.scaleX = 0;
    this.scaleY = 0;
    this.frame = null;

    this.attached = false;
    this.dragging = false;
  }

  start() {
    this.container.addEventListener('dragover', this.handleEvent);
    // touchmove events don't seem to work across siblings, so we unfortunately
    // have to attach the listeners to the body
    window.document.body.addEventListener('touchmove', this.handleEvent);

    this.clearMonitorSubscription = this.dragDropManager
      .getMonitor()
      .subscribeToStateChange(() => this.handleMonitorChange());
  }

  stop() {
    this.container.removeEventListener('dragover', this.handleEvent);
    window.document.body.removeEventListener('touchmove', this.handleEvent);
    this.clearMonitorSubscription();
    this.stopScrolling();
  }

  handleEvent = evt => {
    if (this.dragging && !this.attached) {
      this.attach();
      this.updateScrolling(evt);
    }
  };

  handleMonitorChange() {
    const isDragging = this.dragDropManager.getMonitor().isDragging();

    if (!this.dragging && isDragging) {
      this.dragging = true;
    } else if (this.dragging && !isDragging) {
      this.dragging = false;
      this.stopScrolling();
    }
  }

  attach() {
    this.attached = true;
    window.document.body.addEventListener('dragover', this.updateScrolling);
    window.document.body.addEventListener('touchmove', this.updateScrolling);
  }

  detach() {
    this.attached = false;
    window.document.body.removeEventListener('dragover', this.updateScrolling);
    window.document.body.removeEventListener('touchmove', this.updateScrolling);
  }

  // Update scaleX and scaleY every 100ms or so
  // and start scrolling if necessary
  updateScrolling = throttle(
    evt => {
      const {
        left: x,
        top: y,
        width: w,
        height: h
      } = this.container.getBoundingClientRect();
      const box = { x, y, w, h };
      const coords = getCoords(evt);

      // calculate strength
      this.scaleX = this.options.horizontalStrength(box, coords);
      this.scaleY = this.options.verticalStrength(box, coords);

      // start scrolling if we need to
      if (!this.frame && (this.scaleX || this.scaleY)) {
        this.startScrolling();
      }
    },
    100,
    { trailing: false }
  );

  startScrolling() {
    let i = 0;
    const tick = () => {
      const { scaleX, scaleY, container } = this;
      const { strengthMultiplier, onScrollChange } = this.options;

      // stop scrolling if there's nothing to do
      if (strengthMultiplier === 0 || scaleX + scaleY === 0) {
        this.stopScrolling();
        return;
      }

      // there's a bug in safari where it seems like we can't get
      // mousemove events from a container that also emits a scroll
      // event that same frame. So we double the strengthMultiplier and only adjust
      // the scroll position at 30fps
      if (i++ % 2) {
        const {
          scrollLeft,
          scrollTop,
          scrollWidth,
          scrollHeight,
          clientWidth,
          clientHeight
        } = container;

        const newLeft = scaleX
          ? (container.scrollLeft = intBetween(
              0,
              scrollWidth - clientWidth,
              scrollLeft + scaleX * strengthMultiplier
            ))
          : scrollLeft;

        const newTop = scaleY
          ? (container.scrollTop = intBetween(
              0,
              scrollHeight - clientHeight,
              scrollTop + scaleY * strengthMultiplier
            ))
          : scrollTop;

        onScrollChange(newLeft, newTop);
      }
      this.frame = raf(tick);
    };

    tick();
  }

  stopScrolling() {
    this.detach();
    this.scaleX = 0;
    this.scaleY = 0;

    if (this.frame) {
      raf.cancel(this.frame);
      this.frame = null;
    }
  }
}

const defaultOptions = {
  onScrollChange: noop,
  verticalStrength: defaultVerticalStrength,
  horizontalStrength: defaultHorizontalStrength,
  strengthMultiplier: 30
};

export function useDndScrolling(componentRef, passedOptions) {
  const { dragDropManager } = useContext(DndContext);
  if (!dragDropManager) {
    throw new Error(
      'Unable to get dragDropManager from context. Wrap this in <DndProvider>.'
    );
  }

  useEffect(() => {
    if (!componentRef.current) {
      return () => {};
    }
    const options = defaults(passedOptions, defaultOptions);
    const monitor = new ScrollingMonitor(dragDropManager, componentRef.current, options);
    monitor.start();
    return () => {
      monitor.stop();
    };
  }, [componentRef, dragDropManager, passedOptions]);
}

export default function createScrollingComponent(WrappedComponent) {
  function ScrollingComponent({
    strengthMultiplier,
    verticalStrength,
    horizontalStrength,
    onScrollChange,

    ...passedProps
  }) {
    const ref = useRef(null);
    useDndScrolling(ref, {
      strengthMultiplier,
      verticalStrength,
      horizontalStrength,
      onScrollChange
    });

    return <WrappedComponent {...passedProps} ref={ref} />;
  }

  ScrollingComponent.displayName = `Scrolling(${getDisplayName(WrappedComponent)})`;
  ScrollingComponent.propTypes = {
    onScrollChange: PropTypes.func,
    verticalStrength: PropTypes.func,
    horizontalStrength: PropTypes.func,
    strengthMultiplier: PropTypes.number
  };
  ScrollingComponent.defaultProps = defaultOptions;

  return hoist(ScrollingComponent, WrappedComponent);
}
