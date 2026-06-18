import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';

interface Props {
  children: React.ReactNode;
  /** Fallback heading. Defaults to a generic message. */
  title?: string;
  /** Fallback body text. Defaults to a generic message. */
  message?: string;
  /** Recovery-button label. Defaults to "Try again". */
  resetLabel?: string;
  /**
   * Called when the user taps the recovery button, AFTER the boundary clears
   * its error state. Use it on a NESTED boundary to navigate away from a screen
   * that crashes on render (e.g. pop out of AR) so recovery doesn't just
   * re-mount the same failing tree in place.
   */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Unhandled UI error:', error);
    }
    // In production, forward to a crash-reporting service here.
  }

  handleReset = () => {
    this.setState({ hasError: false, message: undefined });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>{this.props.title ?? 'Something went wrong'}</Text>
          <Text style={styles.message}>
            {this.props.message ?? 'The app hit an unexpected error. You can try again.'}
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>{this.props.resetLabel ?? 'Try again'}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: Colors.background,
  },
  title: { fontSize: 20, fontWeight: '600', color: Colors.text, marginBottom: 8 },
  message: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginBottom: 24 },
  button: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
