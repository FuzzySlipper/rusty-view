#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>
#include <unistd.h>

int main(void) {
  Display *display = XOpenDisplay(NULL);
  if (display == NULL) return 1;

  KeyCode tab = XKeysymToKeycode(display, XK_Tab);
  KeyCode enter = XKeysymToKeycode(display, XK_Return);
  if (tab == 0 || enter == 0) {
    XCloseDisplay(display);
    return 2;
  }

  XTestFakeKeyEvent(display, tab, True, CurrentTime);
  XFlush(display);
  usleep(50000);
  XTestFakeKeyEvent(display, tab, False, CurrentTime);
  XFlush(display);
  usleep(50000);
  XTestFakeKeyEvent(display, enter, True, CurrentTime);
  XFlush(display);
  usleep(50000);
  XTestFakeKeyEvent(display, enter, False, CurrentTime);
  XFlush(display);
  XCloseDisplay(display);
  return 0;
}
