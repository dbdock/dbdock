import cliProgress from 'cli-progress';
import chalk from 'chalk';

export class ProgressTracker {
  private bar: cliProgress.SingleBar | null = null;
  private startTime: number = 0;
  private lastUpdate: number = 0;
  private updateInterval: number = 100;

  start(total: number, label: string = 'Progress') {
    this.startTime = Date.now();
    this.lastUpdate = Date.now();

    this.bar = new cliProgress.SingleBar(
      {
        format:
          chalk.cyan('{bar}') +
          ' | {percentage}% | {value}/{total} MB | Speed: {speed} MB/s | ETA: {eta}s | {label}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: true,
      },
      cliProgress.Presets.shades_classic,
    );

    this.bar.start(total, 0, {
      speed: '0.00',
      label,
      eta: '?',
    });
  }

  update(current: number, label?: string) {
    if (!this.bar) return;

    const now = Date.now();
    if (now - this.lastUpdate < this.updateInterval && current > 0) {
      return;
    }

    this.lastUpdate = now;
    const elapsed = (now - this.startTime) / 1000;
    const speed = elapsed > 0 ? (current / elapsed).toFixed(2) : '0.00';
    const eta =
      current > 0 && elapsed > 0
        ? Math.ceil((this.bar.getTotal() - current) / (current / elapsed))
        : '?';

    this.bar.update(current, {
      speed,
      label: label || 'Processing',
      eta: eta.toString(),
    });
  }

  stop(label?: string) {
    if (!this.bar) return;

    const elapsed = (Date.now() - this.startTime) / 1000;
    const avgSpeed = (this.bar.getTotal() / elapsed).toFixed(2);

    this.bar.update(this.bar.getTotal(), {
      speed: avgSpeed,
      label: label || 'Complete',
      eta: '0',
    });

    this.bar.stop();
    this.bar = null;
  }

  fail(message: string) {
    if (this.bar) {
      this.bar.stop();
      this.bar = null;
    }
    console.error(chalk.red(`✖ ${message}`));
  }
}

export class MultiStepProgress {
  private steps: string[] = [];
  private currentStep: number = 0;
  private startTime: number = 0;

  constructor(steps: string[]) {
    this.steps = steps;
    this.startTime = Date.now();
  }

  start() {
    console.log(chalk.bold('\nProgress:'));
    console.log(chalk.gray('─'.repeat(60)));
    this.showAllSteps();
  }

  private showAllSteps() {
    this.steps.forEach((step, index) => {
      if (index < this.currentStep) {
        console.log(chalk.green(`  ✔ ${step}`));
      } else if (index === this.currentStep) {
        console.log(chalk.cyan(`  ⟳ ${step}...`));
      } else {
        console.log(chalk.gray(`  ○ ${step}`));
      }
    });
  }

  nextStep(message?: string) {
    if (this.currentStep < this.steps.length) {
      process.stdout.moveCursor(0, -(this.steps.length - this.currentStep));
      process.stdout.clearScreenDown();

      console.log(chalk.green(`  ✔ ${this.steps[this.currentStep]}`));

      this.currentStep++;

      for (let i = this.currentStep; i < this.steps.length; i++) {
        if (i === this.currentStep) {
          console.log(chalk.cyan(`  ⟳ ${this.steps[i]}${message ? ' - ' + message : ''}...`));
        } else {
          console.log(chalk.gray(`  ○ ${this.steps[i]}`));
        }
      }
    }
  }

  complete() {
    process.stdout.moveCursor(0, -(this.steps.length - this.currentStep));
    process.stdout.clearScreenDown();

    this.steps.forEach((step) => {
      console.log(chalk.green(`  ✔ ${step}`));
    });

    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.green(`✔ All steps completed in ${elapsed}s\n`));
  }

  fail(error: string) {
    console.log(chalk.red(`\n  ✖ Failed: ${error}\n`));
  }
}
